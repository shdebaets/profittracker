// eBay's search needs every word to match, so one search phrase misses sales titled differently
// ("Godzilla Minus Zero AMC Popcorn Bucket" vs "AMC Godzilla Minus One Bucket Exclusive"). A small
// Claude model reads this product's live titles and writes up to 3 short searches sellers' titles
// would match. Every search is read, merged by listing id, and the AI judge drops the look-alikes.
// Cached a week per product (in comp_cache via lookup), so it's one small AI call per product.
import "server-only"
import { AI_MODEL } from "@/lib/ai/listing"
import { soldPhrase } from "./stats"

const TOOL = {
  name: "searches",
  description: "Return eBay search phrases for this exact product.",
  input_schema: {
    type: "object",
    properties: {
      searches: {
        type: "array",
        items: { type: "string", description: "2 to 6 words. Words most sellers put in the title of this exact product." },
        description: "2 or 3 different searches, each worded the way a different group of sellers titles it.",
      },
    },
    required: ["searches"],
  },
}

const SYSTEM = `You write eBay search phrases that find every sold listing of one exact product.
eBay only returns listings whose title has every word of the search, so keep each search short (2 to 6 words)
and use the words sellers actually use. Make the searches different from each other: different word choices,
nicknames, abbreviations (UPC, ETB, PSA), with or without the brand. Don't add words like new, sealed, lot.
Don't make a search so loose it mostly finds other products: an AI checks every result, but each search reads at most 240 sales.`

/** Merges the AI's searches with the plain cut-down phrase, cleaned and de-duplicated. Pure. */
export function mergeSearches(product: string, ai: unknown, max = 3): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (s: string) => {
    const clean = s.replace(/[^\p{L}\p{N}&'.\- ]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80)
    const words = clean.split(" ").filter(Boolean)
    if (words.length < 2) return
    const k = words.map((w) => w.toLowerCase()).sort().join(" ")
    if (seen.has(k)) return
    seen.add(k)
    out.push(clean)
  }
  add(soldPhrase(product))
  if (Array.isArray(ai)) for (const s of ai) if (typeof s === "string") add(s)
  return out.slice(0, max)
}

export async function searchVariants(product: string, liveTitles: string[]): Promise<string[]> {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) return mergeSearches(product, [])
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 300,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Product: ${product.slice(0, 120)}\nTitles of live listings (some may be other products):\n${liveTitles
            .slice(0, 40)
            .map((t) => `- ${t.slice(0, 120)}`)
            .join("\n")}`,
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`Claude ${res.status}`)
  const body = (await res.json()) as { content?: { type: string; input?: { searches?: unknown } }[] }
  const input = body.content?.find((c) => c.type === "tool_use")?.input
  return mergeSearches(product, input?.searches)
}
