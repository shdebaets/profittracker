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

export type ActiveComp = { priceCents: number; shippingCents: number | null; title: string; condition: string | null; buyItNow: boolean; image?: string | null }
export type SoldComp = { priceCents: number; shippingCents: number | null; soldOn: string; bestOffer: boolean; condition?: string | null; overseas?: boolean }

export type CompStats = {
  /** Every live listing of this exact product on eBay (not just the sample read). */
  activeCount: number
  activeMedian: number | null
  activeLowest: number | null
  sold30: number
  sold90: number
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
const prices = (xs: { priceCents: number; shippingCents: number | null; overseas?: boolean }[]) =>
  xs.map(landed).filter((p): p is number => p != null)

/**
 * Sales per 30 days from how fast the newest reads came in, when they don't reach back 25 days
 * (a busy product: a few hundred sales can be a couple of days). Uses the 90th-percentile age, so
 * one stray old sale in the list doesn't stretch the window. Null when the read already covers it.
 */
export function soldPace(sold: { soldOn: string }[], now: Date): number | null {
  const ages = sold.map((x) => Math.max(daysAgo(x.soldOn, now), 0)).sort((a, b) => a - b)
  if (ages.length < 20) return null
  const i = Math.floor(ages.length * 0.9) - 1
  const span = Math.max(ages[i], 1)
  if (span >= 25) return null
  return Math.round((ages.filter((a) => a <= span).length / span) * 30)
}

const daysAgo = (iso: string, now: Date) => (now.getTime() - new Date(iso + "T12:00:00Z").getTime()) / 86_400_000

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
  soldRead?: { latest: SoldComp[]; total: number | null; oldest?: string | null },
): CompStats {
  const bins = prices(active.filter((a) => a.buyItNow))
  // Best-offer sales show the list price, not what it sold for, so they're left out of prices.
  const priced = (days: number) => prices(sold.filter((s) => daysAgo(s.soldOn, now) <= days && !s.bestOffer))
  // How far back the sales we have go. If they don't cover 30 days (a busy product: the newest few
  // hundred sales can be a couple of days), the 30-day count comes from the pace instead.
  const counted30 = sold.filter((x) => daysAgo(x.soldOn, now) <= 30).length
  // Best case: the read reached eBay's last page, so we know how far back eBay's count goes.
  // All of it inside 30 days (a new release) → the count is eBay's count. Otherwise spread it.
  const counted = soldRead?.total && soldRead.oldest ? Math.round(soldRead.total * Math.min(1, 30 / Math.max(1, daysAgo(soldRead.oldest, now)))) : null
  // When the read already holds every sale eBay has for this search (Godzilla bucket: 111 read of
  // 110), there's nothing to project: the count is the count. Otherwise project from the pace.
  const readAll = !!soldRead?.total && soldRead.latest.length >= soldRead.total * 0.9
  const pace = readAll ? null : soldPace(soldRead?.latest.length ? soldRead.latest : sold, now)
  const sold30Estimated = counted != null ? daysAgo(soldRead!.oldest!, now) > 30 : pace != null && pace > counted30
  let sold30: number = counted != null ? Math.max(counted, counted30) : sold30Estimated && pace != null ? pace : counted30
  // eBay's sold count covers ~90 days, so a projected 30-day number can't be higher than it.
  if (counted == null && sold30Estimated && soldRead?.total) sold30 = Math.max(counted30, Math.min(sold30, soldRead.total))
  const sold90 = Math.max(sold.filter((x) => daysAgo(x.soldOn, now) <= 90).length, sold30Estimated ? sold30 : 0)
  const soldMedian30 = median(priced(30))
  const soldMedian90 = median(priced(90))
  const activeMedian = median(bins)
  // Busy products move fast (launch hype, restocks): use the newest 20 sales once there are 8+ in a week.
  // Prices more than 1.3x their median are dropped first: on eBay those are mostly best-offer sales
  // showing the asking price, which the data can't tell apart (seen on UPC Night: real sales $345-$396,
  // best offers showing $540-$650).
  const newest = prices(
    sold
      .filter((x) => !x.bestOffer && daysAgo(x.soldOn, now) <= 7 && landed(x) != null)
      .sort((a, b) => b.soldOn.localeCompare(a.soldOn))
      .slice(0, 20),
  )
  const rough = median(newest)
  const recentMedian = newest.length >= 8 && rough != null ? median(newest.filter((p) => p <= rough * 1.3)) : null
  const estimate = recentMedian ?? soldMedian30 ?? soldMedian90 ?? activeMedian
  const liveCount = Math.max(active.length, liveTotal ?? 0)
  // Per condition: needs 3+ prices so one odd listing doesn't set it.
  const bucket = (wantNew: boolean) => {
    const soldP = prices(sold.filter((x) => daysAgo(x.soldOn, now) <= (recentMedian != null ? 7 : 90) && !x.bestOffer && isNewCondition(x.condition) === wantNew))
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
    activeLowest: bins.length ? Math.min(...bins.filter((p) => !activeMedian || p >= activeMedian * 0.6)) : null,
    sold30,
    sold90,
    soldMedian30,
    soldMedian90,
    sellThrough: sold30 + liveCount ? sold30 / (sold30 + liveCount) : null,
    daysOfSupply: sold30 ? Math.round(liveCount / (sold30 / 30)) : null,
    estimate,
    sold30Estimated,
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

