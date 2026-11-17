// Comp math for Scan to Comp and tracked products (adapted from CompAmp's sold research). Pure.
import { calcSale } from "@/lib/profit"

export const EBAY_FEE_PCT = 0.1325
export const DEFAULT_LABEL_CENTS = 600

/** Normalised search key so "Nintendo  Switch OLED" and "nintendo switch oled" share comps. */
export const queryKey = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120)

export function median(nums: number[]): number | null {
  const a = nums.filter(Number.isFinite).sort((x, y) => x - y)
  if (!a.length) return null
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2)
}

export type ActiveComp = {
  priceCents: number
  shippingCents: number | null
  title: string
  condition: string | null
  buyItNow: boolean
  image?: string | null
  /** eBay item number (legacy id). */
  itemId?: string | null
  /** Units this live listing has already sold (Browse estimatedSoldQuantity), when looked up. */
  soldQty?: number | null
  /** The day the listing was created (YYYY-MM-DD), when looked up. */
  createdOn?: string | null
}
export type SoldComp = {
  priceCents: number
  shippingCents: number | null
  soldOn: string
  bestOffer: boolean
  condition?: string | null
  overseas?: boolean
  title?: string
  itemId?: string | null
  /** Units the listing sold (Browse estimatedSoldQuantity); unknown counts as 1. */
  units?: number | null
  createdOn?: string | null
  /** Auctions always sell one unit. */
  auction?: boolean
}

export type CompStats = {
  /** Every live listing of this exact product on eBay (not just the sample read). */
  activeCount: number
  activeMedian: number | null
  activeLowest: number | null
  /** Units sold in the last 7 / 30 / 90 full days (Eastern time, ending yesterday). */
  sold7: number
  sold30: number
  sold90: number
  /** Sold listings behind the unit counts (30 days), and how many of them sold more than one unit. */
  soldListings30: number
  multiUnitListings: number
  soldMedian30: number | null
  soldMedian90: number | null
  /** sold in 30 days ÷ (sold in 30 days + live now), as a fraction. */
  sellThrough: number | null
  /** How long it takes to sell the live supply at the last 30 days' pace. */
  daysOfSupply: number | null
  /** Best price estimate and where it came from. */
  estimate: number | null
  estimateSource: "recent" | "sold30" | "sold90" | "active" | null
  /** sold30 worked out from the selling pace, because the sales read don't reach back 30 days. */
  sold30Estimated: boolean
  /**
   * Multi-unit listings are counted from daily readings of their sold counts. Until those readings
   * cover the whole window, the count is a floor ("at least"). countingSince: the first day read.
   */
  sold7Partial?: boolean
  sold30Partial?: boolean
  sold90Partial?: boolean
  countingSince?: string | null
  /** The same estimate for new and for used/open-box units alone, when there's enough of each. */
  newEstimate: number | null
  usedEstimate: number | null
}

/** eBay condition text → new or used. Open box and "new other" count as used: they sell below sealed. */
export const isNewCondition = (c: string | null | undefined) =>
  !!c && /^(brand )?new\b/i.test(c.trim()) && !/other|open box|used|pre-?owned|refurb/i.test(c)

/**
 * What a US buyer paid: price plus shipping, or null for a sale that shipped from overseas. Shipping
 * over $25 on a box like this means an international seller: its price is converted and runs high
 * (seen on UPC Night: $464-$494 with +$44 to +$70 shipping, while US sales were $345-$396).
 */
export const MAX_SHIPPING_CENTS = 2500
export const landed = (x: { priceCents: number; shippingCents: number | null; overseas?: boolean }): number | null =>
  x.overseas || (x.shippingCents != null && x.shippingCents > MAX_SHIPPING_CENTS) ? null : x.priceCents + (x.shippingCents ?? 0)
/**
 * The item price alone (overseas sales still left out), what sold medians and the estimate use, as
 * CompAmp does. eBay shows calculated shipping for the viewer's location, so the same sale's
 * shipping differs between readers (45% of matched Night and Godzilla sales did, API vs
 * extension); the item price never did.
 */
export const itemPrice = (x: { priceCents: number; shippingCents: number | null; overseas?: boolean }): number | null =>
  landed(x) == null ? null : x.priceCents
const prices = (xs: { priceCents: number; shippingCents: number | null; overseas?: boolean }[]) =>
  xs.map(itemPrice).filter((p): p is number => p != null)

/**
 * Sales per 30 days from how fast the newest reads came in, when they don't reach back 25 days
 * (a busy product: a few hundred sales can be a couple of days). Uses the 90th-percentile age, so
 * one stray old sale in the list doesn't stretch the window. Null when the read already covers it.
 */
export function soldPace(sold: { soldOn: string }[], now: Date, window = 30): number | null {
  const ages = sold.map((x) => Math.max(daysAgo(x.soldOn, now), 0)).sort((a, b) => a - b)
  if (ages.length < 20) return null
  const i = Math.floor(ages.length * 0.9) - 1
  const span = Math.max(ages[i], 1)
  if (span >= window * (25 / 30)) return null
  return Math.round((ages.filter((a) => a <= span).length / span) * window)
}

const daysAgo = (iso: string, now: Date) => (now.getTime() - new Date(iso + "T12:00:00Z").getTime()) / 86_400_000

/** Pre-sale listings sell before release at made-up prices: left out of prices (still counted as sales). */
export const PRESALE = /\b(pre-?sale|pre-?order|presell|ships? (by|on|in|after)|confirmed (order|pre))\b/i

/** Today's date in New York (eBay US days), YYYY-MM-DD. */
export const etDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" })
const shiftDay = (day: string, n: number) => new Date(Date.parse(day + "T12:00:00Z") + n * 86_400_000).toISOString().slice(0, 10)

/** Each listing's eBay sold count by day it was read (comp_item_counts), keyed by item id. */
export type UnitHistory = Map<string, { day: string; qty: number }[]>

/**
 * Every unit sold, by day. eBay's lifetime sold count can't say when units sold (a relisted
 * listing keeps its old total, Night Nov 16: "230 sold" on a listing Terapeak shows selling under
 * 40 that week), so units come from day-to-day changes in that count (`history`): a listing read
 * at 200 one day and 209 the next sold 9, spread over the days between readings. Before a
 * listing's first reading, only what the sold search showed counts: one unit on its last sale day.
 * Live listings count only through their changes. Pure.
 */
export function reconcileUnits(sold: SoldComp[], live: ActiveComp[], _today: string, history: UnitHistory = new Map()): { day: string; qty: number }[] {
  const lastSold = new Map<string, string>()
  sold.forEach((s, i) => {
    const id = s.itemId ?? `row:${i}`
    const d = lastSold.get(id)
    if (!d || s.soldOn > d) lastSold.set(id, s.soldOn)
  })
  const ids = new Set([...lastSold.keys(), ...live.flatMap((a) => (a.itemId ? [a.itemId] : []))])
  const out: { day: string; qty: number }[] = []
  for (const id of ids) {
    const h = [...(history.get(id) ?? [])].sort((a, b) => a.day.localeCompare(b.day))
    const soldOn = lastSold.get(id)
    for (let i = 1; i < h.length; i++) {
      const delta = h[i].qty - h[i - 1].qty
      if (delta <= 0) continue
      const days: string[] = []
      for (let d = shiftDay(h[i - 1].day, 1); d <= h[i].day; d = shiftDay(d, 1)) days.push(d)
      for (const d of days) out.push({ day: d, qty: delta / days.length })
    }
    // The sale the sold search showed, unless the readings already cover that day.
    if (soldOn && (!h.length || soldOn <= h[0].day || soldOn > h[h.length - 1].day)) out.push({ day: soldOn, qty: 1 })
  }
  return out
}

/** Units in the last `n` days, today included (a launch-day product sells most of its units today). Pure. */
export function unitsIn(days: { day: string; qty: number }[], today: string, n: number): number {
  const from = shiftDay(today, -(n - 1))
  return Math.round(days.reduce((sum, d) => (d.day >= from && d.day <= today ? sum + d.qty : sum), 0))
}

/**
 * `liveTotal`: how many live listings eBay says match (the search reads at most a page of them),
 * already scaled down for look-alikes the AI judge dropped. Defaults to the ones passed in.
 */
export function compStats(
  active: ActiveComp[],
  sold: SoldComp[],
  now = new Date(),
  liveTotal?: number,
  /** From the latest sold read: its rows (so older, patchier reads don't stretch the span) and eBay's own match count, already scaled by the share that was this product. */
  soldRead?: { latest: SoldComp[]; total: number | null; within30?: number | null },
  /** Daily readings of each listing's eBay sold count (units come from their changes). */
  history?: UnitHistory,
): CompStats {
  const bins = prices(active.filter((a) => a.buyItNow))
  // Lowest live is what a buyer pays today, shipping included (CompAmp's lowest BIN).
  const binsLanded = active.filter((a) => a.buyItNow).map(landed).filter((p): p is number => p != null)
  // Prices: best offers (they show the asking price, not what it sold for) and pre-sales are left
  // out, then a guard drops prices under 0.55x or over 1.9x the clean median (mislabeled lots,
  // parts, the odd best offer the data can't flag). They still count as sales.
  const clean = sold.filter((s) => !s.bestOffer && !PRESALE.test(s.title ?? ""))
  const ref = median(prices(clean.filter((s) => daysAgo(s.soldOn, now) <= 90)))
  const inBand = (s: SoldComp) => {
    const p = itemPrice(s)
    return p != null && (ref == null || clean.length < 4 || (p >= ref * 0.55 && p <= ref * 1.9))
  }
  const priced = (days: number) => prices(clean.filter((s) => daysAgo(s.soldOn, now) <= days && inBand(s)))

  // Units, not listings: a listing's daily sold-count changes, else one unit per sale the search showed.
  const today = etDay(now)
  const unitDays = reconcileUnits(sold, active, today, history)
  const listings30 = sold.filter((x) => daysAgo(x.soldOn, now) <= 30)
  const units30 = unitsIn(unitDays, today, 30)
  // Units per sold listing in the read, to turn a listing count into units.
  const perListing = listings30.length ? Math.max(1, units30 / listings30.length) : 1
  // When the sales read don't reach back far enough (a busy product: a few thousand sales a month
  // can be more than every page read), the count comes from eBay's own 30-day count or the pace.
  // Best case: the read found where eBay's results cross 30 days ago (already scaled by the judge).
  const counted = soldRead?.within30 ?? null
  // When the read already holds every sale eBay has for this search, there's nothing to project.
  const readAll = !!soldRead?.total && soldRead.latest.length >= soldRead.total * 0.9
  const paceRows = soldRead?.latest.length ? soldRead.latest : sold
  const pace30 = readAll ? null : soldPace(paceRows, now, 30)
  const pace7 = readAll ? null : soldPace(paceRows, now, 7)
  let anchor30 = counted ?? pace30
  // eBay's sold count covers ~90 days, so a projected 30-day count can't be higher than it.
  if (counted == null && anchor30 != null && soldRead?.total) anchor30 = Math.min(anchor30, soldRead.total)
  const projected30 = anchor30 != null && anchor30 > listings30.length ? Math.round(anchor30 * perListing) : null
  const sold30Estimated = counted == null && projected30 != null && projected30 > units30
  const sold30 = Math.max(units30, projected30 ?? 0)
  const units7 = unitsIn(unitDays, today, 7)
  // Readings cover a window when the first one is from the day before it starts (changes are
  // counted from the day after a reading). Only listings that sell more than one unit need them.
  const multiIds = new Set([
    ...sold.filter((s) => !s.auction && (s.units ?? 1) > 1 && s.itemId).map((s) => s.itemId!),
    ...active.filter((a) => (a.soldQty ?? 0) > 1 && a.itemId).map((a) => a.itemId!),
  ])
  const firstReadings = [...multiIds].map((id) => history?.get(id)?.reduce((m, h) => (h.day < m ? h.day : m), "9999") ?? today)
  const countingSince = firstReadings.length ? firstReadings.reduce((m, d) => (d < m ? d : m), today) : null
  const partial = (n: number) => countingSince != null && countingSince > shiftDay(today, -n)
  const listings7 = sold.filter((x) => daysAgo(x.soldOn, now) <= 7).length
  const sold7 = Math.min(sold30, Math.max(units7, pace7 != null && pace7 > listings7 ? Math.round(pace7 * perListing) : 0))
  const sold90 = Math.max(unitsIn(unitDays, today, 90), sold30)
  const soldMedian30 = median(priced(30))
  const soldMedian90 = median(priced(90))
  const activeMedian = median(bins)
  // Busy products move fast (launch hype, restocks): use the newest 20 sales once there are 8+ in a week.
  // Prices more than 1.3x their median are dropped first: on eBay those are mostly best-offer sales
  // showing the asking price, which the data can't tell apart (seen on UPC Night: real sales $345-$396,
  // best offers showing $540-$650).
  const newest = prices(
    clean
      .filter((x) => daysAgo(x.soldOn, now) <= 7 && inBand(x))
      .sort((a, b) => b.soldOn.localeCompare(a.soldOn))
      .slice(0, 20),
  )
  const rough = median(newest)
  const recentMedian = newest.length >= 8 && rough != null ? median(newest.filter((p) => p <= rough * 1.3)) : null
  const estimate = recentMedian ?? soldMedian30 ?? soldMedian90 ?? activeMedian
  const liveCount = Math.max(active.length, liveTotal ?? 0)
  // Per condition: needs 3+ prices so one odd listing doesn't set it.
  const bucket = (wantNew: boolean) => {
    const soldP = prices(clean.filter((x) => daysAgo(x.soldOn, now) <= (recentMedian != null ? 7 : 90) && inBand(x) && isNewCondition(x.condition) === wantNew))
    if (soldP.length >= 3) return median(soldP)
    const liveP = prices(active.filter((a) => a.buyItNow && isNewCondition(a.condition) === wantNew))
    return liveP.length >= 3 ? median(liveP) : null
  }
  return {
    newEstimate: bucket(true),
    usedEstimate: bucket(false),
    activeCount: liveCount,
    activeMedian,
    // Under 60% of the median is almost always a scam, a pre-order or a mislabeled part, not a real buy.
    activeLowest: (() => {
      const lowMedian = median(binsLanded)
      const ok = binsLanded.filter((p) => !lowMedian || p >= lowMedian * 0.6)
      return ok.length ? Math.min(...ok) : null
    })(),
    sold7,
    sold30,
    sold90,
    soldListings30: listings30.length,
    multiUnitListings: listings30.filter((s) => !s.auction && (s.units ?? 1) > 1).length,
    soldMedian30,
    soldMedian90,
    sellThrough: sold30 + liveCount ? sold30 / (sold30 + liveCount) : null,
    daysOfSupply: sold30 ? Math.round(liveCount / (sold30 / 30)) : null,
    estimate,
    sold30Estimated,
    sold7Partial: partial(7),
    sold30Partial: partial(30),
    sold90Partial: partial(90),
    countingSince,
    estimateSource: recentMedian != null ? "recent" : soldMedian30 != null ? "sold30" : soldMedian90 != null ? "sold90" : activeMedian != null ? "active" : null,
  }
}

/** "Buy at $8, sells for ~$32, profit ~$18": eBay fee on the sale and a shipping label. */
export function buyProfit(costCents: number, sellCents: number, labelCents = DEFAULT_LABEL_CENTS) {
  const s = calcSale({ costCents, salePriceCents: sellCents, quantity: 1, feePct: EBAY_FEE_PCT, labelCostCents: labelCents })
  return { profit: s.net, fees: s.fees, roi: costCents > 0 ? s.net / costCents : null }
}

/** A UPC/EAN/ISBN typed or scanned: 8, 12, 13 or 14 digits. */
export const isGtin = (s: string) => /^(\d{8}|\d{12,14})$/.test(s.trim())

/**
 * The words sent to the sold search. eBay needs every word to match, so the product name is cut to
 * the core: "Pokémon TCG 30th Celebration Ultra Premium Collection Night (Umbreon)" missed the
 * many sales titled "Pokemon 30th Anniversary UPC … Night" with no "TCG" or "Celebration". The wider
 * search brings in look-alikes too; the AI judge drops those. Pure.
 */
export function soldPhrase(product: string): string {
  const words = product
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[|•–—\-:,]/g, " ")
    .replace(/\b(tcg|ccg|celebration|anniversary|edition|official|brand|new|sealed|factory|the|and|of)\b/gi, " ")
    .split(/\s+/)
    .filter(Boolean)
  return words.slice(0, 7).join(" ") || product
}

