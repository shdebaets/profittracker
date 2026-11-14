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
export type SoldComp = { priceCents: number; shippingCents: number | null; soldOn: string; bestOffer: boolean; condition?: string | null }

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

const daysAgo = (iso: string, now: Date) => (now.getTime() - new Date(iso + "T12:00:00Z").getTime()) / 86_400_000

/**
 * `liveTotal`: how many live listings eBay says match (the search reads at most a page of them),
 * already scaled down for look-alikes the AI judge dropped. Defaults to the ones passed in.
 */
export function compStats(active: ActiveComp[], sold: SoldComp[], now = new Date(), liveTotal?: number): CompStats {
  const bins = active.filter((a) => a.buyItNow).map((a) => a.priceCents + (a.shippingCents ?? 0))
  // Best-offer sales show the list price, not what it sold for, so they're left out of prices.
  const priced = (days: number) => sold.filter((s) => daysAgo(s.soldOn, now) <= days && !s.bestOffer).map((s) => s.priceCents + (s.shippingCents ?? 0))
  // How far back the sales we have go. If they don't cover 30 days (a busy product: the newest few
  // hundred sales can be a couple of days), the 30-day count comes from the pace instead.
  const ages = sold.map((x) => daysAgo(x.soldOn, now)).filter((d) => d >= 0)
  const span = ages.length ? Math.max(...ages) : 0
  const counted30 = sold.filter((x) => daysAgo(x.soldOn, now) <= 30).length
  const sold30Estimated = ages.length >= 20 && span < 25
  const sold30 = sold30Estimated ? Math.round((counted30 / Math.max(span, 1)) * 30) : counted30
  const sold90 = Math.max(sold.filter((x) => daysAgo(x.soldOn, now) <= 90).length, sold30Estimated ? sold30 : 0)
  const soldMedian30 = median(priced(30))
  const soldMedian90 = median(priced(90))
  const activeMedian = median(bins)
  // Busy products move fast (launch hype, restocks): use the newest 20 sales once there are 8+ in a week.
  // Prices more than 1.5x their median are dropped first: on eBay those are mostly best-offer sales
  // showing the asking price, which the data can't tell apart.
  const newest = sold
    .filter((x) => !x.bestOffer && daysAgo(x.soldOn, now) <= 7)
    .sort((a, b) => b.soldOn.localeCompare(a.soldOn))
    .slice(0, 20)
    .map((x) => x.priceCents + (x.shippingCents ?? 0))
  const rough = median(newest)
  const recentMedian = newest.length >= 8 && rough != null ? median(newest.filter((p) => p <= rough * 1.5)) : null
  const estimate = recentMedian ?? soldMedian30 ?? soldMedian90 ?? activeMedian
  const liveCount = Math.max(active.length, liveTotal ?? 0)
  // Per condition: needs 3+ prices so one odd listing doesn't set it.
  const bucket = (wantNew: boolean) => {
    const soldP = sold.filter((x) => daysAgo(x.soldOn, now) <= (recentMedian != null ? 7 : 90) && !x.bestOffer && isNewCondition(x.condition) === wantNew).map((x) => x.priceCents + (x.shippingCents ?? 0))
    if (soldP.length >= 3) return median(soldP)
    const liveP = active.filter((a) => a.buyItNow && isNewCondition(a.condition) === wantNew).map((a) => a.priceCents + (a.shippingCents ?? 0))
    return liveP.length >= 3 ? median(liveP) : null
  }
  return {
    newEstimate: bucket(true),
    usedEstimate: bucket(false),
    activeCount: liveCount,
    activeMedian,
    activeLowest: bins.length ? Math.min(...bins) : null,
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
