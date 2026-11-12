import "server-only"
import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import { z } from "zod"
import { UserError } from "@/lib/errors"
import { bumpUsage, ebaySearch, sumPrice, type Summary } from "./ebay"
import type { Profile } from "./profile"

// Claude calls for research: identify products in search results, build a tracking
// profile, and judge listings. Structured outputs guarantee parseable JSON, so a bad
// character can no longer stall a batch.

export const ID_MODEL = process.env.RESEARCH_ID_MODEL ?? "claude-sonnet-5-5"
export const JUDGE_MODEL = process.env.RESEARCH_JUDGE_MODEL ?? "claude-haiku-5-5"

// $ per million tokens: input, output. Cache writes cost 1.25x input, cache reads 0.1x.
const RATES: [string, number, number][] = [
  ["haiku-5-5", 0.1, 0.5],
  ["sonnet-5-5", 2, 10],
  ["opus-5-5", 4, 20],
]

let client: Anthropic | null = null
function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new UserError("Research isn't set up yet: the Anthropic API key is missing.")
  client ??= new Anthropic()
  return client
}

type Content = Anthropic.Beta.BetaContentBlockParam[] | string

async function ask<S extends z.ZodType>(opts: {
  model: string
  system: string
  content: Content
  schema: S
  maxTokens: number
  effort: "low" | "medium" | "high"
  cacheSystem?: boolean
}): Promise<z.infer<S>> {
  const res = await anthropic().beta.messages.parse({
    model: opts.model,
    max_tokens: opts.maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: opts.cacheSystem ? [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }] : opts.system,
    messages: [{ role: "user", content: opts.content }],
    output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
  })
  const u = res.usage
  const rate = RATES.find(([k]) => res.model.includes(k)) ?? ["", 2, 10]
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1
  const output = u.output_tokens ?? 0
  await bumpUsage("anthropic", res.model, 1, input, output, (input * rate[1] + output * rate[2]) / 1_000_000)
  if (res.stop_reason === "refusal") throw new UserError("The AI declined to read these listings. Try a more specific search.")
  if (!res.parsed_output) throw new Error(`AI answer couldn't be read (stop: ${res.stop_reason})`)
  return res.parsed_output
}

// ---------- identify ----------

export type Candidate = {
  name: string
  description: string
  image_url: string | null
  price_low: number | null
  price_high: number | null
  count: number
  example_ids: string[]
}

const IdentifySchema = z.object({
  products: z.array(
    z.object({
      n: z.string(),
      d: z.string(),
      l: z.number().nullable(),
      h: z.number().nullable(),
      c: z.number(),
      e: z.array(z.number()),
    }),
  ),
})

// The identify step's eBay results are reused when the user picks a product (same instance, 10 min).
const samplesCache = new Map<string, { expires: number; items: Summary[] }>()
const normalize = (q: string) => q.trim().replace(/\s+/g, " ").toLowerCase()

export async function searchSamples(query: string) {
  const key = normalize(query)
  const hit = samplesCache.get(key)
  if (hit && hit.expires > Date.now()) return hit.items
  const { items } = await ebaySearch(key, 0, 200)
  samplesCache.set(key, { expires: Date.now() + 10 * 60_000, items })
  if (samplesCache.size > 50) samplesCache.delete(samplesCache.keys().next().value!)
  return items
}

export async function identify(query: string): Promise<Candidate[]> {
  const items = await searchSamples(query)
  if (!items.length) return []
  const rows = items.map((s, i) => ({ i, t: s.title, p: sumPrice(s), c: s.categories?.[0]?.categoryName ?? "" }))
  const out = await ask({
    model: ID_MODEL,
    effort: "low",
    maxTokens: 4000,
    schema: IdentifySchema,
    system:
      "You identify distinct physical products inside eBay search results. A 'product' is one specific item a reseller would buy and sell (a specific set, SKU, edition), not a broad category. Group listings of the same product together, including its versions/variants. Ignore accessories, lots of unrelated items and junk.",
    content: `Search query: "${normalize(query)}"
Here are ${rows.length} eBay results as JSON lines (i: listing index, t: title, p: price, c: category):
${rows.map((r) => JSON.stringify(r)).join("\n")}

Return up to 8 distinct products, most common first. n = exact product name, d = one-line description, l/h = typical price low/high, c = matching result count, e = up to 8 matching listing indices (best representative first).`,
  })
  return out.products.slice(0, 8).map((p) => {
    const examples = p.e.filter(Number.isInteger).map((i) => items[i]).filter((s): s is Summary => !!s).slice(0, 8)
    const rep = examples.find((s) => s.image?.imageUrl || s.thumbnailImages?.[0]?.imageUrl)
    return {
      name: p.n,
      description: p.d,
      price_low: p.l,
      price_high: p.h,
      count: p.c,
      example_ids: examples.map((s) => s.itemId),
      image_url: rep?.image?.imageUrl ?? rep?.thumbnailImages?.[0]?.imageUrl ?? null,
    }
  })
}

// ---------- profile ----------

const ProfileSchema = z.object({
  canonical_name: z.string(),
  brand: z.string(),
  category: z.string(),
  upc: z.string().nullable(),
  release_date: z.string().nullable(),
  versions: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      aliases: z.array(z.string()),
      abbreviations: z.array(z.string()),
      color_hints: z.array(z.string()),
      price_low: z.number().nullable(),
      price_high: z.number().nullable(),
    }),
  ),
  other_editions: z.array(z.object({ name: z.string(), words: z.array(z.string()) })),
  keywords: z.array(z.string()),
  exclusions: z.array(z.object({ label: z.string(), words: z.array(z.string()) })),
})

export async function buildProfile(query: string, card: Candidate): Promise<Profile> {
  const samples = await searchSamples(query)
  const picked = new Set(card.example_ids)
  const sample = [...samples.filter((s) => picked.has(s.itemId)), ...samples.filter((s) => !picked.has(s.itemId)).slice(0, 60)].map(
    (s) => ({ t: s.title, p: sumPrice(s) }),
  )
  const p = await ask({
    model: ID_MODEL,
    effort: "medium",
    maxTokens: 6000,
    schema: ProfileSchema,
    system: `You build tracking profiles so a tracker can find every eBay listing of one exact product and nothing else. Lessons:
- Spelled-out names beat abbreviation tags: sellers stuff tags into every title, so never rely on abbreviations alone to tell versions apart.
- Series names appear in titles of other versions.
- A bundle like "set of 2" / "both" is its own version.
- If the user picked one edition of a product that comes in several (e.g. one color or variant), track only that edition as the single version and list the others in other_editions with the words that identify them, so their listings are rejected.
- Exclusions should catch look-alikes: promo items sold alone, accessories, empty boxes, other sizes, graded items, other languages, cases or multiple units, breaks/repacks, other similar products. Exclusion words are lowercase substrings matched against titles; only include words that would never appear in a genuine listing.
- release_date: the product's release date as YYYY-MM-DD if the titles make it clear (e.g. "PRE ORDER 11/06"), else null.`,
    content: `User searched "${normalize(query)}" and picked: ${JSON.stringify(card)}
Sample titles and prices:
${sample.map((s) => JSON.stringify(s)).join("\n")}

keywords: 6 to 10 eBay search phrases that together cast a wide net for this exact product. Version keys are snake_case.`,
  })
  return { ...p, brand: p.brand || undefined, category: p.category || undefined }
}

// ---------- judge ----------

export type JudgeRow = { id: string; t: string; p: number; cond: string | null; cat: string | null }
export type Verdict = { id: string; v: string; r: string; c: number }

const JudgeSchema = z.object({
  r: z.array(z.object({ id: z.string(), v: z.string(), r: z.string(), c: z.number() })),
})

/** Judge up to ~60 listings: version key | unknown_version | reject | review. Rows without a verdict are omitted. */
export async function judge(profile: Profile, examples: { title: string; decision: string }[], rows: JudgeRow[]): Promise<Verdict[]> {
  const versions = profile.versions.map((v) => ({ key: v.key, name: v.name, aliases: v.aliases, color_hints: v.color_hints, price: [v.price_low, v.price_high] }))
  const system = `You decide whether each eBay listing is exactly this product and which version it is. Product: ${profile.canonical_name} (${profile.brand ?? ""}).
Versions: ${JSON.stringify(versions)}
Other editions (not tracked, reject them): ${JSON.stringify(profile.other_editions ?? [])}
Exclusions: ${JSON.stringify(profile.exclusions)}
Rules: spelled-out names beat abbreviation tags (sellers stuff tags into every title); series names appear in other versions' titles; "set of 2"/bundles are their own version if one exists, else reject; mixed editions or multiple boxes sold together → reject unless a version covers them. A single box from a multi-quantity inventory listing is valid: do not reject it for inventory quantity. Other languages, graded, empty boxes, accessories, promos sold alone, breaks/repacks → reject. If it's the product but the version is unclear → "unknown_version". If genuinely unsure → "review".
${examples.length ? `Past human decisions:\n${examples.slice(-30).map((e) => `- "${e.title}" → ${e.decision}`).join("\n")}` : ""}
Input: one JSON per line {id: row reference, t: title, p: total price incl. shipping, cond, cat}. Return every row reference exactly once with v = a version key, "unknown_version", "reject" or "review", r = reason in at most 8 words, c = confidence 0-1.`
  const out = await ask({
    model: JUDGE_MODEL,
    effort: "low",
    maxTokens: 8000,
    schema: JudgeSchema,
    cacheSystem: true,
    system,
    content: rows.map((r, i) => JSON.stringify({ ...r, id: String(i) })).join("\n"),
  })
  return out.r.flatMap((v) => {
    const row = rows[Number(v.id)]
    return row ? [{ ...v, id: row.id }] : []
  })
}
