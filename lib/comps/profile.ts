// A product's search profile (from CompAmp's buildProfile): the eBay searches that together find
// every sale of it, plus the words that mark look-alikes. eBay needs every word of a search to
// match, and sellers title the same box a dozen ways ("UPC Night", "Ultra Premium Collection
// Umbreon", "30th Anniversary Celebration Night"), so one search finds a fraction of the sales.
// Built once per product by a bigger Claude model (cached a week in comp_cache by lookup).
import "server-only"
import { mergeSearches } from "./variants"

export type CompProfile = {
  /** 6 to 10 eBay searches that together find every sale of this product. */
  keywords: string[]
  /** Lowercase words that never appear in a genuine listing of it ("case only", "empty box"). */
  exclusions: string[]
  /** Words that name this edition (night, umbreon). Empty when the product has no editions. */
  editionWords: string[]
  /** Other editions in the same line and the words that name them (Day: day, espeon). */
  otherEditions: { name: string; words: string[] }[]
}

export const PROFILE_MODEL = () => process.env.COMP_PROFILE_MODEL?.trim() || "claude-sonnet-5-5"

const TOOL = {
  name: "profile",
  description: "Return the search profile for this exact product.",
  input_schema: {
    type: "object",
    properties: {
      keywords: {
        type: "array",
        items: { type: "string", description: "2 to 6 words, the way a group of sellers titles this exact product." },
        description: "6 to 10 eBay search phrases that together cast a wide net over every listing of this product.",
      },
      exclusions: {
        type: "array",
        items: { type: "string" },
        description: "Lowercase words or short phrases that would never appear in a genuine single listing of the product (e.g. 'empty box', 'case only', 'proxy', 'custom').",
      },
      edition_words: {
        type: "array",
        items: { type: "string" },
        description: "Lowercase words that name THIS edition/version/design when the line has several (e.g. night, umbreon). Empty if the product has no siblings.",
      },
      other_editions: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string" }, words: { type: "array", items: { type: "string" } } },
          required: ["name", "words"],
        },
        description: "Other editions, versions, designs or sizes in the same line, each with lowercase words that name it (e.g. Day: day, espeon).",
      },
    },
    required: ["keywords", "exclusions", "edition_words", "other_editions"],
  },
}

const SYSTEM = `You build eBay search profiles that find every sold listing of one exact product.
eBay only returns listings whose title contains every word of the search, so each keyword must be short (2 to 6 words) and use words sellers really use.
Lessons from real listings:
- Spelled-out names find more than abbreviation tags: write "ultra premium collection night" as well as "upc night".
- Cover the different ways groups of sellers word it: with and without the brand, nicknames, character names, store names ("amc", "sams club"), abbreviations.
- Series names also appear in other versions' titles, so a keyword with only the series name finds siblings too. That's fine (an AI checks every result) but every keyword should be likely to contain this product.
- "Set of 2", "lot" and bundles are separate products, not this one.
Exclusions are words that would never be in a genuine listing of this one product.
If the product line has several editions, designs, colors, sizes or characters, list THIS one's words in edition_words and every sibling in other_editions with its words. Use whole words only, never words this product's own title needs.`

/** Cleans what the AI returned; falls back to the plain cut-down phrase. Pure. */
export function cleanProfile(product: string, raw: unknown): CompProfile {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const words = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.toLowerCase().replace(/\s+/g, " ").trim())
      .filter((s) => s.length >= 2 && s.length <= 40)
  const own = new Set(product.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))
  const editionWords = [...new Set(words(o.edition_words ?? o.editionWords))].slice(0, 8)
  const otherEditions = (Array.isArray(o.other_editions ?? o.otherEditions) ? ((o.other_editions ?? o.otherEditions) as unknown[]) : [])
    .flatMap((e) => {
      const x = (e && typeof e === "object" ? e : {}) as Record<string, unknown>
      const name = typeof x.name === "string" ? x.name.trim().slice(0, 80) : ""
      // A word this product's own name uses can't mark a sibling ("collection" in both).
      const w = [...new Set(words(x.words))].filter((s) => !own.has(s) && !editionWords.includes(s))
      return name && w.length ? [{ name, words: w.slice(0, 8) }] : []
    })
    .slice(0, 12)
  return {
    keywords: mergeSearches(product, o.keywords, 10),
    exclusions: [...new Set(words(o.exclusions))].filter((s) => !product.toLowerCase().includes(s)).slice(0, 20),
    editionWords,
    otherEditions,
  }
}

const wordRe = (w: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu")

/** A title with an exclusion word in it ("empty box", "case only"). Pure. */
export const excluded = (title: string, p: Pick<CompProfile, "exclusions">) => {
  const t = title.toLowerCase()
  return p.exclusions.some((w) => t.includes(w))
}

/**
 * Which edition a title names, by whole words: "other" (only a sibling's words: a Day box when
 * pricing Night), "mixed" (this edition and a sibling: "Day and Night"), else "keep". Pure.
 */
export function editionVerdict(title: string, p: Pick<CompProfile, "editionWords" | "otherEditions">): "keep" | "other" | "mixed" {
  const names = (ws: string[]) => ws.some((w) => wordRe(w).test(title))
  const other = p.otherEditions.some((e) => names(e.words))
  if (!other) return "keep"
  return p.editionWords.length && names(p.editionWords) ? "mixed" : "other"
}

export async function buildProfile(product: string, liveTitles: string[]): Promise<CompProfile> {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) return cleanProfile(product, {})
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: PROFILE_MODEL(),
      max_tokens: 2000,
      tools: [TOOL],
      // Sonnet 5.5 refuses forced tool choice ("tool"/"any"), so the prompt asks for the tool instead.
      tool_choice: { type: "auto" },
      system: `${SYSTEM}\nAlways answer by calling the ${TOOL.name} tool, once, with no other text.`,
      messages: [
        {
          role: "user",
          content: `Product: ${product.slice(0, 160)}\nTitles of live eBay listings for it (some are other products or editions):\n${liveTitles
            .slice(0, 80)
            .map((t) => `- ${t.slice(0, 140)}`)
            .join("\n")}`,
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as { content?: { type: string; input?: unknown }[] }
  const input = body.content?.find((c) => c.type === "tool_use")?.input
  // No tool call: throw so the fallback isn't cached for a week.
  if (!input) throw new Error("Claude gave no profile")
  return cleanProfile(product, input)
}
