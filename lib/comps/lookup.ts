import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { cached, IDENTIFY_TTL_MS, LIVE_TTL_MS } from "./cache"
import { searchActive, type LiveSearch } from "./ebay-browse"
import { identifyProducts, type ProductCandidate } from "./identify"
import { judgeTitles } from "./judge"
import { compStats, isGtin, queryKey, type CompStats, type SoldComp } from "./stats"

export type CompLookup = {
  /** What sold history is filed under (and what the extension searches eBay for). */
  query: string
  gtin: string | null
  /** The exact product these numbers are for. */
  product: string
  title: string | null
  image: string | null
  stats: CompStats
  soldCollectedAt: string | null
  /** Listings the AI judge left out as not this exact product (cases, lots, parts, other models). */
  filteredOut: number
}

/** A loose search matched several products: the seller picks one first. */
export type CompPick = { query: string; candidates: ProductCandidate[] }

/** A product title trimmed to the words that matter for a search. */
export const searchPhrase = (title: string) =>
  title.replace(/\b(new|sealed|brand|free shipping|fast|nib|nwt|authentic|look|rare|l@@k)\b/gi, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 8).join(" ")

const liveSearch = (input: { gtin?: string; q?: string }) =>
  cached<LiveSearch>(input.gtin ? `live:gtin:${input.gtin}` : `live:q:${queryKey(input.q ?? "")}`, LIVE_TTL_MS, () => searchActive(input))

/**
 * Comps for a barcode, or for typed words. Typed words that cover several products (as judged by
 * the AI from the live listings) come back as a CompPick unless `product` says which one.
 */
export async function lookupComps(
  supabase: SupabaseClient,
  input: string,
  opts: { now?: Date; userId?: string | null; product?: string | null } = {},
): Promise<CompLookup | CompPick> {
  const now = opts.now ?? new Date()
  const raw = input.trim()
  const gtin = isGtin(raw) ? raw : null
  let product = opts.product?.trim() || null

  let live = await liveSearch(gtin ? { gtin } : { q: product ? searchPhrase(product) : raw })
  if (!gtin && !product) {
    const candidates = await cached(`id:${queryKey(raw)}`, IDENTIFY_TTL_MS, () => identifyProducts(raw, live.comps)).catch((e) => {
      console.error("[comp identify]", e)
      return [] as ProductCandidate[]
    })
    if (candidates.length > 1) return { query: raw, candidates }
    if (candidates.length === 1) {
      product = candidates[0].name
      live = await liveSearch({ q: searchPhrase(product) })
    }
  }
  // A barcode names one product, but its first listing's title can be odd ("…NO DOCK", "lot of 2").
  // Ask for the clean product name from all its listings (cached a day per barcode).
  if (gtin && !product && live.comps.length > 1) {
    const [top] = await cached(`id:gtin:${gtin}`, IDENTIFY_TTL_MS, () => identifyProducts(`barcode ${gtin}`, live.comps)).catch((e) => {
      console.error("[comp identify]", e)
      return [] as ProductCandidate[]
    })
    product = top?.name ?? null
  }
  product ??= (gtin ? live.title : null) ?? raw
  const query = searchPhrase(product)

  const since = new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10)
  const { data } = await supabase
    .from("comp_sales")
    .select("title, price_cents, shipping_cents, sold_on, best_offer, condition, collected_at")
    .eq("query_key", queryKey(query))
    .gte("sold_on", since)
    .limit(1000)
  const judge = await judgeTitles(product, [...live.comps.map((c) => c.title), ...(data ?? []).map((r) => r.title)], opts.userId ?? null)
  const active = live.comps.filter((c) => judge.keep(c.title))
  const rows = (data ?? []).filter((r) => judge.keep(r.title))
  const filteredOut = live.comps.length - active.length + ((data?.length ?? 0) - rows.length)
  // eBay's total counts every match; scale it by the share of the sample that was really this product.
  const liveTotal = live.comps.length ? Math.round((live.total * active.length) / live.comps.length) : 0
  const sold: SoldComp[] = rows.map((r) => ({ priceCents: r.price_cents, shippingCents: r.shipping_cents, soldOn: r.sold_on, bestOffer: r.best_offer, condition: r.condition }))
  const latest = rows.reduce<string | null>((m, r) => (!m || r.collected_at > m ? r.collected_at : m), null)
  // Show a listing that really is the product, not whatever eBay ranked first.
  const shown = active[0] ?? null
  return {
    query,
    gtin,
    product,
    title: gtin ? product : shown?.title ?? product,
    image: shown?.image ?? live.image,
    stats: compStats(active, sold, now, liveTotal),
    soldCollectedAt: latest,
    filteredOut,
  }
}

export const isPick = (r: CompLookup | CompPick): r is CompPick => "candidates" in r
