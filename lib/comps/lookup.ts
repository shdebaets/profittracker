import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { cached, IDENTIFY_TTL_MS, LIVE_TTL_MS } from "./cache"
import { searchActive, type LiveSearch } from "./ebay-browse"
import { buildHistory, type HistoryDay } from "./history"
import { identifyProducts, type ProductCandidate } from "./identify"
import { judgeTitles } from "./judge"
import { lastSoldRead, refreshSoldFromApi } from "./sold-api"
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
  /** The newest sales behind the numbers, so sellers can check them. */
  recentSales: { title: string; priceCents: number; shippingCents: number | null; soldOn: string; bestOffer: boolean; condition: string | null }[]
  /** Sold listings read for this search that the judge didn't count, newest first (for checking). */
  droppedSales: { title: string; priceCents: number; soldOn: string }[]
  /** Last 90 days, one row per day: sales, sold median, live listings and lowest price (for the charts). */
  history: HistoryDay[]
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
  opts: { now?: Date; userId?: string | null; product?: string | null; skipPaidSold?: boolean } = {},
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

  // Sold prices from the data provider when nobody has read this product in 12 hours (no-op without a key).
  if (!opts.skipPaidSold) await refreshSoldFromApi(query)
  const read = await lastSoldRead(query).catch(() => null)
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
  // The latest read on its own (older reads can be patchy), and eBay's sold count scaled like liveTotal.
  const readRows = read ? (data ?? []).filter((r) => Math.abs(Date.parse(r.collected_at) - Date.parse(read.at)) < 1000) : []
  const readKept = readRows.filter((r) => judge.keep(r.title))
  const soldRead = read
    ? {
        latest: readKept.map((r) => ({ priceCents: r.price_cents, shippingCents: r.shipping_cents, soldOn: r.sold_on, bestOffer: r.best_offer, condition: r.condition })),
        total: read.total && readRows.length ? Math.round((read.total * readKept.length) / readRows.length) : null,
      }
    : undefined
  const latest = rows.reduce<string | null>((m, r) => (!m || r.collected_at > m ? r.collected_at : m), null)
  // Show a listing that really is the product, not whatever eBay ranked first.
  const shown = active[0] ?? null
  const byDate = <T extends { sold_on: string }>(a: T, b: T) => b.sold_on.localeCompare(a.sold_on)
  const recentSales = [...rows].sort(byDate).slice(0, 25).map((r) => ({
    title: r.title, priceCents: r.price_cents, shippingCents: r.shipping_cents, soldOn: r.sold_on, bestOffer: r.best_offer, condition: r.condition,
  }))
  const droppedSales = (data ?? []).filter((r) => !judge.keep(r.title)).sort(byDate).slice(0, 10).map((r) => ({ title: r.title, priceCents: r.price_cents, soldOn: r.sold_on }))
  const stats = compStats(active, sold, now, liveTotal, soldRead)
  const history = await recordAndReadHistory(queryKey(query), stats, sold, now).catch((e) => {
    console.error("[comp history]", e)
    return [] as HistoryDay[]
  })
  return {
    history,
    recentSales,
    droppedSales,
    query,
    gtin,
    product,
    title: gtin ? product : shown?.title ?? product,
    image: shown?.image ?? live.image,
    stats,
    soldCollectedAt: latest,
    filteredOut,
  }
}

/**
 * Saves a snapshot of the live market (at most one per 2 hours per product, matching the live
 * cache) and returns the 90-day daily history for the charts.
 */
async function recordAndReadHistory(key: string, stats: CompStats, sold: SoldComp[], now: Date): Promise<HistoryDay[]> {
  const admin = createAdminClient()
  const since = new Date(now.getTime() - 90 * 86_400_000).toISOString()
  const { data: snaps } = await admin
    .from("comp_snapshots")
    .select("taken_at, live_count, lowest_cents")
    .eq("query_key", key)
    .gte("taken_at", since)
    .order("taken_at", { ascending: true })
    .limit(2000)
  const list = snaps ?? []
  const last = list.at(-1)
  if (stats.activeCount > 0 && (!last || now.getTime() - Date.parse(last.taken_at) > LIVE_TTL_MS)) {
    const row = { query_key: key, taken_at: now.toISOString(), live_count: stats.activeCount, lowest_cents: stats.activeLowest, median_cents: stats.activeMedian }
    const { error } = await admin.from("comp_snapshots").insert(row)
    if (!error) list.push(row)
  }
  return buildHistory(sold, list, now)
}

export const isPick = (r: CompLookup | CompPick): r is CompPick => "candidates" in r
