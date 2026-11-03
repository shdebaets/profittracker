import type { ItemCondition } from "@/lib/marketplaces/registry"

/** A live listing found on a marketplace, not yet in FlipLedger. */
export type ImportCandidate = {
  marketplace: "poshmark" | "mercari"
  /** The marketplace's own listing ID (Poshmark's 24-hex ID, Mercari's m123…). */
  externalId: string
  url: string
  title: string
  description: string
  priceCents: number | null
  brand: string
  size: string
  condition: ItemCondition | null
  photoUrl: string | null
}

export type ImportPlan = {
  /** Already tracked in FlipLedger (same marketplace listing). */
  skip: ImportCandidate[]
  /** Same title as an inventory item without a listing there yet: add the listing to it. */
  link: { candidate: ImportCandidate; itemId: string }[]
  /** New inventory items. */
  create: ImportCandidate[]
}

const ID_IN_URL: Record<string, RegExp> = {
  poshmark: /-([0-9a-f]{24})(?:[/?#]|$)/,
  mercari: /\/item\/(m\d+)/,
}

/** "poshmark:6ae3…" for a saved listing link, or null if the link has no listing ID. */
export function listingKey(marketplace: string, url: string | null): string | null {
  const id = String(url ?? "").match(ID_IN_URL[marketplace] ?? /$^/)?.[1]
  return id ? `${marketplace}:${id}` : null
}

/** Titles compared loosely: case, spacing and punctuation don't matter ("Levi's" = "levis"). */
export const sameTitle = (t: string | null) =>
  String(t ?? "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim()

/**
 * Decide what importing `candidates` does. Matching by title is what joins the same
 * item listed on Poshmark and Mercari: whichever import runs second links to the
 * item the first one created.
 */
export function planImport(
  candidates: ImportCandidate[],
  existing: {
    items: { id: string; title: string | null; status: string }[]
    listings: { item_id: string; marketplace: string; external_url: string | null }[]
  },
): ImportPlan {
  const tracked = new Set(existing.listings.map((l) => listingKey(l.marketplace, l.external_url)).filter(Boolean))
  const listedOn = new Set(existing.listings.map((l) => `${l.item_id}:${l.marketplace}`))
  const byTitle = new Map<string, string[]>()
  for (const i of existing.items) {
    if (i.status !== "inventory" || !sameTitle(i.title)) continue
    byTitle.set(sameTitle(i.title), [...(byTitle.get(sameTitle(i.title)) ?? []), i.id])
  }

  const plan: ImportPlan = { skip: [], link: [], create: [] }
  const seen = new Set<string>()
  for (const c of candidates) {
    const key = `${c.marketplace}:${c.externalId}`
    if (seen.has(key)) continue
    seen.add(key)
    if (tracked.has(key)) {
      plan.skip.push(c)
      continue
    }
    const itemId = byTitle.get(sameTitle(c.title))?.find((id) => !listedOn.has(`${id}:${c.marketplace}`))
    if (itemId) {
      listedOn.add(`${itemId}:${c.marketplace}`)
      plan.link.push({ candidate: c, itemId })
    } else plan.create.push(c)
  }
  return plan
}
