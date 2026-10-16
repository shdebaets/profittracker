import { inRange, type Range } from "./dates"
import type { Item, Platform } from "./types"

export type FeePreset = {
  id: Platform
  label: string
  hint: string
  pct: number // fraction, e.g. 0.1325
  fixedCents: number
}

export const FEE_PRESETS: FeePreset[] = [
  { id: "cash", label: "0% Cash/Local", hint: "Cash in person, Craigslist, FB Marketplace", pct: 0, fixedCents: 0 },
  { id: "card", label: "2.9% + $0.30 Card", hint: "Square, Stripe, PayPal G&S", pct: 0.029, fixedCents: 30 },
  { id: "mercari_depop", label: "10% Depop/Mercari", hint: "Flat 10% selling fee", pct: 0.1, fixedCents: 0 },
  { id: "ebay", label: "13.25% eBay Std", hint: "Standard eBay category final value fee", pct: 0.1325, fixedCents: 0 },
  { id: "poshmark_amz", label: "15% Poshmark/Amz", hint: "Higher tier platforms (15%+)", pct: 0.15, fixedCents: 0 },
  { id: "custom", label: "Custom Fee %", hint: "Manual rate entry", pct: 0, fixedCents: 0 },
]

export function presetFor(id: Platform | null | undefined): FeePreset {
  return FEE_PRESETS.find((p) => p.id === id) ?? FEE_PRESETS[0]
}

export type SaleInput = {
  costCents: number // per unit
  salePriceCents: number // per unit
  quantity: number
  buyerShippingCents?: number
  labelCostCents?: number
  feePct?: number
  feeFixedCents?: number
}

export type SaleBreakdown = {
  revenue: number
  fees: number
  cog: number
  shipping: number
  net: number
  margin: number
}

export function calcSale(s: SaleInput): SaleBreakdown {
  const qty = Math.max(1, Math.floor(s.quantity || 1))
  const revenue = s.salePriceCents * qty + (s.buyerShippingCents ?? 0)
  const fees = revenue > 0 ? Math.round(revenue * (s.feePct ?? 0)) + (s.feeFixedCents ?? 0) : 0
  const cog = s.costCents * qty
  const shipping = s.labelCostCents ?? 0
  const net = revenue - fees - shipping - cog
  return { revenue, fees, cog, shipping, net, margin: revenue > 0 ? net / revenue : 0 }
}

export function itemSale(i: Item): SaleBreakdown {
  return calcSale({
    costCents: i.cost_cents,
    salePriceCents: i.sale_price_cents ?? 0,
    quantity: i.quantity,
    buyerShippingCents: i.buyer_shipping_cents,
    labelCostCents: i.label_cost_cents,
    feePct: Number(i.fee_pct),
    feeFixedCents: i.fee_fixed_cents,
  })
}

export type Summary = {
  net: number
  revenue: number
  cogSold: number
  fees: number
  salesCount: number
  avgProfit: number
  margin: number
  inventoryValue: number
  inventoryUnits: number
  inventoryItems: number
  totalItems: number
  best: { item: Item; sale: SaleBreakdown } | null
}

/** Sales are filtered by sold_at within range; inventory is always a current snapshot. */
export function summarize(items: Item[], range: Range, now = new Date()): Summary {
  let net = 0, revenue = 0, cogSold = 0, fees = 0, salesCount = 0
  let inventoryValue = 0, inventoryUnits = 0, inventoryItems = 0, totalItems = 0
  let best: Summary["best"] = null

  for (const i of items) {
    if (i.status === "inventory") {
      inventoryValue += i.cost_cents * i.quantity
      inventoryUnits += i.quantity
      inventoryItems++
      if (inRange(i.purchased_at, range, now)) totalItems++
    } else if (i.status === "sold" && inRange(i.sold_at, range, now)) {
      const s = itemSale(i)
      net += s.net
      revenue += s.revenue
      cogSold += s.cog
      fees += s.fees
      salesCount++
      totalItems++
      if (!best || s.net > best.sale.net) best = { item: i, sale: s }
    }
  }

  return {
    net,
    revenue,
    cogSold,
    fees,
    salesCount,
    avgProfit: salesCount ? Math.round(net / salesCount) : 0,
    margin: revenue ? net / revenue : 0,
    inventoryValue,
    inventoryUnits,
    inventoryItems,
    totalItems,
    best,
  }
}

export type HaulLine = { title: string; quantity: number; estValueCents: number }

/**
 * Split a lump-sum receipt across lines proportionally to est. value × qty
 * (equal weight per unit if no values given). Costs are whole cents per unit,
 * so leftover cents go one-per-unit to the heaviest lines that can absorb them;
 * line totals match the receipt exactly unless every remaining line has more
 * units than there are leftover cents (drift is then < the smallest qty).
 */
export function distributeHaul(
  totalCents: number,
  lines: HaulLine[],
): { unitCostCents: number; lineTotalCents: number }[] {
  if (!lines.length) return []
  const qtys = lines.map((l) => Math.max(1, l.quantity))
  const weights = lines.map((l, i) => qtys[i] * Math.max(0, l.estValueCents))
  const w = weights.some((x) => x > 0) ? weights : qtys
  const sum = w.reduce((a, b) => a + b, 0)

  const units = w.map((wi, i) => Math.floor((totalCents * wi) / sum / qtys[i]))
  let leftover = totalCents - units.reduce((a, u, i) => a + u * qtys[i], 0)
  const order = w.map((wi, idx) => ({ wi, idx })).sort((a, b) => b.wi - a.wi)
  let progressed = true
  while (leftover > 0 && progressed) {
    progressed = false
    for (const { idx } of order) {
      if (qtys[idx] <= leftover) {
        units[idx]++
        leftover -= qtys[idx]
        progressed = true
      }
    }
  }
  return units.map((u, i) => ({ unitCostCents: u, lineTotalCents: u * qtys[i] }))
}

export function mileageDeduction(miles: number, rateCents: number): number {
  return Math.round(miles * rateCents)
}
