import "server-only"
import { after } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { cached, IDENTIFY_TTL_MS, LIVE_TTL_MS } from "./cache"
import { searchActive, type LiveSearch } from "./ebay-browse"
import { buildHistory, type HistoryDay } from "./history"
import { identifyProducts, type ProductCandidate } from "./identify"
import { judgeTitles } from "./judge"
import { buildProfile, cleanProfile, type CompProfile } from "./profile"
import { lastSoldRead, refreshSoldFromApi } from "./sold-api"
import { compStats, isGtin, queryKey, type ActiveComp, type CompStats, type SoldComp } from "./stats"
import { backgroundUnitCalls, loadUnitHistory, loadUnits } from "./units"

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
  /** The eBay searches sold prices are read from (AI-written, 6 to 10), for the extension and phone app. */
  searches: string[]
  /** Other editions the numbers leave out (e.g. "Day"), so the seller can see which one this is. */
  otherEditions: string[]
}

/** A loose search matched several products: the seller picks one first. */
export type CompPick = { query: string; candidates: ProductCandidate[] }

/** A product title trimmed to the words that matter for a search. */
export const searchPhrase = (title: string) =>
  title.replace(/\b(new|sealed|brand|free shipping|fast|nib|nwt|authentic|look|rare|l@@k)\b/gi, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 8).join(" ")

// live2: 200 a search, with item ids (for units and merging searches).
const liveSearch = (input: { gtin?: string; q?: string }) =>
  cached<LiveSearch>(input.gtin ? `live2:gtin:${input.gtin}` : `live2:q:${queryKey(input.q ?? "")}`, LIVE_TTL_MS, () => searchActive(input))

/** Live listings from every keyword, one per item id; eBay's biggest match count. */
async function liveAcross(first: LiveSearch, keywords: string[]): Promise<{ comps: ActiveComp[]; total: number }> {
  const all = [first, ...(await Promise.all(keywords.map((q) => liveSearch({ q }).catch(() => null))))].filter((x): x is LiveSearch => !!x)
  const byId = new Map<string, ActiveComp>()
  const noId: ActiveComp[] = []
  for (const s of all)
    for (const c of s.comps) {
      if (c.itemId) byId.set(c.itemId, c)
      else noId.push(c)
    }
  return { comps: [...byId.values(), ...noId], total: Math.max(...all.map((s) => s.total)) }
}

/**
 * Comps for a barcode, or for typed words. Typed words that cover several products (as judged by
 * the AI from the live listings) come back as a CompPick unless `product` says which one.
 */
export async function lookupComps(
  supabase: SupabaseClient,
  input: string,
  opts: {
    now?: Date
    userId?: string | null
    product?: string | null
    skipPaidSold?: boolean
    /**
     * In a request (server action): when the product already has sold data, answer from it now
     * and refresh sold listings and units after the response (`after`). The next lookup shows
     * them. Cron jobs leave this off and wait.
     */
    background?: boolean
    /** Runs once the product is known, before any paid read or AI profile (the member's daily cap; throws to stop). */
    gate?: (key: string) => Promise<void>
  } = {},
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
  await opts.gate?.(queryKey(query))

  // The product's search profile: 6 to 10 keywords worded the way different sellers title it, and
  // the words that mark other editions and junk (one bigger AI call, cached 30 days: a product's
  // wording doesn't change, and this is the priciest AI call in a lookup).
  const profile: CompProfile = await cached(`prof1:${queryKey(query)}`, 30 * 24 * 60 * 60_000, () => buildProfile(product, live.comps.map((c) => c.title))).catch((e) => {
    console.error("[comp profile]", e)
    return cleanProfile(product, {})
  })
  const searches = profile.keywords
  // Live listings from every keyword (each cached 2 hours), merged by item id.
  const market = gtin ? { comps: live.comps, total: live.total } : await liveAcross(live, searches)
  // Sold prices from the data provider when nobody has read this product in 12 hours (no-op without a key).
  const before = await lastSoldRead(query).catch(() => null)
  // Instant when there's something to show: a product read before refreshes in the background.
  // A read that found nothing doesn't count: wait for a real one rather than show "no sold data".
  const later = !!opts.background && !!before && before.results > 0
  if (!opts.skipPaidSold) {
    if (later) after(() => refreshSoldFromApi(query, searches).then(() => undefined))
    else await refreshSoldFromApi(query, searches)
  }
  const read = later ? before : await lastSoldRead(query).catch(() => null)
  const since = new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10)
  // Every sale on file for the product in 90 days, from any reader (extension, phone app, paid
  // provider), one row per listing. PostgREST returns 1,000 rows a request, so page.
  type Row = { external_id: string; title: string; price_cents: number; shipping_cents: number | null; sold_on: string; best_offer: boolean; condition: string | null; collected_at: string; overseas: boolean; auction: boolean }
  const data: Row[] = []
  for (let from = 0; from < 6000; from += 1000) {
    const { data: page } = await supabase
      .from("comp_sales")
      .select("external_id, title, price_cents, shipping_cents, sold_on, best_offer, condition, collected_at, overseas, auction")
      .eq("query_key", queryKey(query))
      .gte("sold_on", since)
      .order("sold_on", { ascending: false })
      .range(from, from + 999)
    data.push(...((page ?? []) as Row[]))
    if ((page?.length ?? 0) < 1000) break
  }
  // Sold titles first: they make the counts, so they get judged first if a lookup has more new titles than the judge takes.
  const judge = await judgeTitles(product, [...data.map((r) => r.title), ...market.comps.map((c) => c.title)], opts.userId ?? null, profile)
  const keptLive = market.comps.filter((c) => judge.keep(c.title))
  const rows = data.filter((r) => judge.keep(r.title))
  const filteredOut = market.comps.length - keptLive.length + (data.length - rows.length)
  // eBay's total counts every match; scale it by the share of the sample that was really this product.
  const liveTotal = market.comps.length ? Math.max(keptLive.length, Math.round((market.total * keptLive.length) / market.comps.length)) : 0
  // Units per listing (Browse API, cached per listing): live ones and non-auction sales from the last 90 days.
  const unitIds = [...keptLive.flatMap((c) => (c.itemId ? [c.itemId] : [])), ...rows.filter((r) => !r.auction).map((r) => r.external_id)]
  const liveIds = new Set(keptLive.flatMap((c) => (c.itemId ? [c.itemId] : [])))
  // In the background mode, use the units already on file now and look up the rest afterwards.
  const units = await loadUnits(unitIds, liveIds, { fetch: !later })
  // In a request, read the rest of the listings' unit counts after the response, so the next open
  // has them all (a busy product has 1,000+ listings; one lookup only waits for 80).
  if (opts.background) after(() => loadUnits(unitIds, liveIds, { calls: backgroundUnitCalls() }).then(() => undefined))
  const active: ActiveComp[] = keptLive.map((c) => {
    const u = c.itemId ? units.get(c.itemId) : undefined
    return { ...c, soldQty: u?.soldQty ?? null, createdOn: u?.createdOn ?? null }
  })
  const toSold = (r: Row): SoldComp => {
    const u = units.get(r.external_id)
    return {
      priceCents: r.price_cents, shippingCents: r.shipping_cents, soldOn: r.sold_on, bestOffer: r.best_offer, condition: r.condition, overseas: r.overseas,
      title: r.title, itemId: r.external_id, auction: r.auction, units: u?.soldQty ?? null, createdOn: u?.createdOn ?? null,
    }
  }
  const sold: SoldComp[] = rows.map(toSold)
  // The latest read on its own (older reads can be patchy), and eBay's sold count scaled like liveTotal.
  const readRows = read ? data.filter((r) => Math.abs(Date.parse(r.collected_at) - Date.parse(read.at)) < 1000) : []
  const readKept = readRows.filter((r) => judge.keep(r.title))
  const soldRead = read
    ? {
        latest: readKept.map(toSold),
        // eBay's results inside 30 days, scaled by the share of this read's last-30-day sales the judge kept.
        within30: (() => {
          if (!read.within30) return null
          const month = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)
          const recent = readRows.filter((r) => r.sold_on >= month)
          return recent.length ? Math.round((read.within30 * recent.filter((r) => judge.keep(r.title)).length) / recent.length) : null
        })(),
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
  const droppedSales = data.filter((r) => !judge.keep(r.title)).sort(byDate).slice(0, 10).map((r) => ({ title: r.title, priceCents: r.price_cents, soldOn: r.sold_on }))
  // Units from each listing's daily sold-count readings (comp_item_counts).
  const unitHistory = await loadUnitHistory(unitIds)
  const stats = compStats(active, sold, now, liveTotal, soldRead, unitHistory)
  const history = await recordAndReadHistory(queryKey(query), stats, sold, now).catch((e) => {
    console.error("[comp history]", e)
    return [] as HistoryDay[]
  })
  return {
    searches,
    otherEditions: profile.otherEditions.map((e) => e.name),
    history,
    recentSales,
    droppedSales,
    query,
    gtin,
    product,
    title: gtin ? product : shown?.title ?? product,
    image: shown?.image ?? live.image ?? null,
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
    const row = {
      query_key: key, taken_at: now.toISOString(), live_count: stats.activeCount, lowest_cents: stats.activeLowest, median_cents: stats.activeMedian,
      sold_median_cents: stats.soldMedian30 ?? stats.soldMedian90, sold30: stats.sold30,
    }
    const { error } = await admin.from("comp_snapshots").insert(row)
    if (!error) list.push(row)
  }
  return buildHistory(sold, list, now)
}

export const isPick = (r: CompLookup | CompPick): r is CompPick => "candidates" in r
