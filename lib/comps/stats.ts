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

export type ActiveComp = { priceCents: number; shippingCents: number | null; title: string; condition: string | null; buyItNow: boolean }
export type SoldComp = { priceCents: number; shippingCents: number | null; soldOn: string; bestOffer: boolean }

export type CompStats = {
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
  estimateSource: "sold30" | "sold90" | "active" | null
}

const daysAgo = (iso: string, now: Date) => (now.getTime() - new Date(iso + "T12:00:00Z").getTime()) / 86_400_000

export function compStats(active: ActiveComp[], sold: SoldComp[], now = new Date()): CompStats {
  const bins = active.filter((a) => a.buyItNow).map((a) => a.priceCents + (a.shippingCents ?? 0))
  // Best-offer sales show the list price, not what it sold for, so they're left out of prices.
  const priced = (days: number) => sold.filter((s) => daysAgo(s.soldOn, now) <= days && !s.bestOffer).map((s) => s.priceCents + (s.shippingCents ?? 0))
  const sold30 = sold.filter((s) => daysAgo(s.soldOn, now) <= 30).length
  const sold90 = sold.filter((s) => daysAgo(s.soldOn, now) <= 90).length
  const soldMedian30 = median(priced(30))
  const soldMedian90 = median(priced(90))
  const activeMedian = median(bins)
  const estimate = soldMedian30 ?? soldMedian90 ?? activeMedian
  return {
    activeCount: active.length,
    activeMedian,
    activeLowest: bins.length ? Math.min(...bins) : null,
    sold30,
    sold90,
    soldMedian30,
    soldMedian90,
    sellThrough: sold30 + active.length ? sold30 / (sold30 + active.length) : null,
    daysOfSupply: sold30 ? Math.round(active.length / (sold30 / 30)) : null,
    estimate,
    estimateSource: soldMedian30 != null ? "sold30" : soldMedian90 != null ? "sold90" : activeMedian != null ? "active" : null,
  }
}

/** "Buy at $8, sells for ~$32, profit ~$18": eBay fee on the sale and a shipping label. */
export function buyProfit(costCents: number, sellCents: number, labelCents = DEFAULT_LABEL_CENTS) {
  const s = calcSale({ costCents, salePriceCents: sellCents, quantity: 1, feePct: EBAY_FEE_PCT, labelCostCents: labelCents })
  return { profit: s.net, fees: s.fees, roi: costCents > 0 ? s.net / costCents : null }
}

/** A UPC/EAN/ISBN typed or scanned: 8, 12, 13 or 14 digits. */
export const isGtin = (s: string) => /^(\d{8}|\d{12,14})$/.test(s.trim())
