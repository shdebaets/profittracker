// CompAmp's AI judge, folded into Scan to Comp: a small Claude model reads listing titles and keeps
// only the exact product (drops cases, lots, parts/repair, empty boxes, other models and sizes).
// Verdicts are cached per product and title in comp_judgments, so a title is only judged once.
import "server-only"
import { createHash } from "node:crypto"
import { AI_MODEL } from "@/lib/ai/listing"
import { createAdminClient } from "@/lib/supabase/admin"
import { queryKey } from "./stats"

const MAX_PER_CALL = 80
const hash = (t: string) => createHash("sha256").update(t.trim().toLowerCase()).digest("base64url").slice(0, 22)

const TOOL = {
  name: "verdicts",
  description: "Return which listings are the exact product.",
  input_schema: {
    type: "object",
    properties: {
      keep: { type: "array", items: { type: "integer" }, description: "Indices of listings that are exactly the product." },
    },
    required: ["keep"],
  },
}

const SYSTEM = `You check eBay listing titles for a reseller pricing one exact product.
Keep a listing only if it is that product itself, sold as one unit, in working condition.
Reject: accessories or cases sold alone, empty boxes, manuals, parts or "for repair", broken, lots or bundles of several units, other models, sizes, editions or generations, graded items when the product isn't graded, and anything you can't tell is the product.
Condition differences (new, used, open box) are fine. Missing accessories are fine unless the title says it's only part of the product.`

async function askClaude(product: string, titles: string[]): Promise<{ keep: Set<number>; usage: { input: number; output: number } } | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) return null
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 600,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Product: ${product.slice(0, 200)}\nListings:\n${titles.map((t, i) => `${i}: ${t.slice(0, 140)}`).join("\n")}`,
        },
      ],
    }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    content?: { type: string; name?: string; input?: { keep?: unknown } }[]
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  if (!res.ok) throw new Error(`Claude ${res.status}`)
  const keep = body.content?.find((c) => c.type === "tool_use")?.input?.keep
  if (!Array.isArray(keep)) throw new Error("Claude gave no verdicts")
  return {
    keep: new Set(keep.filter((n): n is number => Number.isInteger(n))),
    usage: { input: body.usage?.input_tokens ?? 0, output: body.usage?.output_tokens ?? 0 },
  }
}

/**
 * Which titles are the exact product. Titles it couldn't judge (no API key, Claude down) count as
 * kept, so comps still work, just unfiltered. `userId` is only for the spend log.
 */
export async function judgeTitles(product: string, titles: string[], userId: string | null): Promise<{ keep: (t: string) => boolean; judged: boolean }> {
  const unique = [...new Set(titles.map((t) => t.trim()).filter(Boolean))]
  if (!unique.length || !product.trim()) return { keep: () => true, judged: false }
  const pk = queryKey(product)
  const admin = createAdminClient()
  const verdicts = new Map<string, boolean>()

  const hashes = unique.map(hash)
  for (let i = 0; i < hashes.length; i += 200) {
    const { data } = await admin.from("comp_judgments").select("title_hash, keep").eq("query_key", pk).in("title_hash", hashes.slice(i, i + 200))
    for (const r of data ?? []) verdicts.set(r.title_hash, r.keep)
  }

  let judged = true
  const todo = unique.filter((t) => !verdicts.has(hash(t))).slice(0, MAX_PER_CALL * 2)
  for (let i = 0; i < todo.length; i += MAX_PER_CALL) {
    const batch = todo.slice(i, i + MAX_PER_CALL)
    try {
      const out = await askClaude(product, batch)
      if (!out) {
        judged = false
        break
      }
      const rows = batch.map((t, j) => ({ query_key: pk, title_hash: hash(t), keep: out.keep.has(j) }))
      for (const r of rows) verdicts.set(r.title_hash, r.keep)
      await admin.from("comp_judgments").upsert(rows, { onConflict: "query_key,title_hash" })
      if (userId) await admin.from("ai_usage").insert({ user_id: userId, kind: "comp_judge", input_tokens: out.usage.input, output_tokens: out.usage.output })
    } catch (e) {
      console.error("[comp judge]", e)
      judged = false
      break
    }
  }
  return { keep: (t) => verdicts.get(hash(t)) ?? true, judged }
}
