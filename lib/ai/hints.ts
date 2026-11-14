// What "Write it from photos" suggests beyond the listing fields, kept on the item (items.ai_hints)
// and used by the eBay form (category + item specifics) and the extension (Mercari/Poshmark
// category paths, Facebook title). Pure; safe in the browser.
import type { ListingDraft } from "./listing"

export type AiHints = {
  /** eBay-style category path from the AI, e.g. "Clothing, Shoes & Accessories > Men > Coats". */
  category: string
  specifics: { name: string; value: string }[]
  priceNote: string
  mercariCategory: string[]
  poshmarkCategory: string[]
  facebookTitle: string
}

const clean = (path: string[]) => path.map((x) => x.trim()).filter(Boolean).slice(0, 5)

export function aiHintsFrom(d: ListingDraft): AiHints {
  return {
    category: d.category,
    specifics: d.item_specifics,
    priceNote: d.price_note,
    mercariCategory: clean(d.mercari_category),
    poshmarkCategory: clean(d.poshmark_category),
    facebookTitle: d.facebook_title.trim().slice(0, 99),
  }
}

/**
 * What to ask eBay's category suggestions for: the AI category's most specific level plus the
 * title, so "Coats" alone doesn't pull in coat racks. Falls back to the title.
 */
export function ebayCategoryQuery(category: string | null | undefined, title: string): string {
  const leaf = (category ?? "").split(/>|›/).map((x) => x.trim()).filter(Boolean).pop() ?? ""
  const t = title.trim()
  const q = leaf && !t.toLowerCase().includes(leaf.toLowerCase()) ? `${leaf} ${t}` : t || leaf
  return q.slice(0, 200)
}

type AspectLike = { name: string; multi: boolean; freeText: boolean; values: string[] }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

/**
 * Item specifics filled from the AI's, by aspect name (case/punctuation-insensitive). Pick-list
 * aspects only take a value eBay offers (matched loosely, written eBay's way); free-text ones take
 * the AI's value. Aspects with no AI value are left out.
 */
export function prefillAspects(aspects: AspectLike[], specifics: { name: string; value: string }[]): Record<string, string> {
  const byName = new Map(specifics.map((s) => [norm(s.name), s.value.trim()]))
  const out: Record<string, string> = {}
  for (const a of aspects) {
    const v = byName.get(norm(a.name))
    if (!v) continue
    const allowed = a.values.find((x) => norm(x) === norm(v))
    if (allowed) out[a.name] = allowed
    else if (a.freeText || !a.values.length) out[a.name] = v
  }
  return out
}

/** Read items.ai_hints defensively (older rows, hand edits). */
export function readHints(raw: unknown): AiHints | null {
  if (!raw || typeof raw !== "object") return null
  const h = raw as Partial<AiHints>
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [])
  return {
    category: typeof h.category === "string" ? h.category : "",
    specifics: Array.isArray(h.specifics)
      ? h.specifics.filter((s): s is { name: string; value: string } => typeof s?.name === "string" && typeof s?.value === "string")
      : [],
    priceNote: typeof h.priceNote === "string" ? h.priceNote : "",
    mercariCategory: strs(h.mercariCategory),
    poshmarkCategory: strs(h.poshmarkCategory),
    facebookTitle: typeof h.facebookTitle === "string" ? h.facebookTitle : "",
  }
}
