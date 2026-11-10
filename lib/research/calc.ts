// eBay profit math for research (dollars, not cents: these are market prices, not ledger rows).

export type ResearchFees = {
  feePct: number // final value fee %, charged on price + shipping + tax
  taxPct: number // average buyer sales tax %, part of eBay's fee base
  perOrderFee: number
  yourShipping: number // your label cost
}

export const DEFAULT_RESEARCH_FEES: ResearchFees = { feePct: 13.25, taxPct: 7, perOrderFee: 0.4, yourShipping: 15 }
export const TARGET_ROI = 30

export function profitAt(salePrice: number, buyerShipping: number, cost: number, f: ResearchFees) {
  const base = salePrice + buyerShipping
  const fvf = base * (1 + f.taxPct / 100) * (f.feePct / 100)
  const totalFees = fvf + f.perOrderFee
  const profit = base - totalFees - f.yourShipping - cost
  return { totalFees, profit, roi: cost > 0 ? (profit / cost) * 100 : null }
}

/** Highest cost that still reaches the target ROI at this sale price. */
export function maxCost(salePrice: number, buyerShipping: number, f: ResearchFees, targetRoi = TARGET_ROI) {
  return Math.max(0, profitAt(salePrice, buyerShipping, 0, f).profit / (1 + targetRoi / 100))
}

export type Verdict = "BUY" | "THIN" | "SKIP"
export function verdict(roi: number | null, targetRoi = TARGET_ROI): Verdict | null {
  if (roi == null) return null
  if (roi >= targetRoi) return "BUY"
  if (roi >= targetRoi / 2) return "THIN"
  return "SKIP"
}

export function median(nums: number[]) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y)
  if (!a.length) return null
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2
}
