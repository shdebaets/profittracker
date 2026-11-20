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
  { id: "cash", label: "0% Cash/Local", hint: "Cash in person, Craigslist, FB local pickup", pct: 0, fixedCents: 0 },
  { id: "card", label: "2.9% + $0.30 Card", hint: "Square, Stripe, PayPal G&S", pct: 0.029, fixedCents: 30 },
  { id: "mercari_depop", label: "10% Depop/Mercari", hint: "Flat 10% selling fee", pct: 0.1, fixedCents: 0 },
  { id: "ebay", label: "13.25% eBay Std", hint: "Standard eBay category final value fee", pct: 0.1325, fixedCents: 0 },
  { id: "poshmark_amz", label: "15% Poshmark/Amz", hint: "Higher tier platforms (15%+)", pct: 0.15, fixedCents: 0 },
  { id: "facebook", label: "10% FB Shipped", hint: "Facebook Marketplace shipped sales", pct: 0.1, fixedCents: 0 },
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
  /** Refunded to the buyer after the sale. Revenue stays gross; profit drops. */
  refundCents?: number
  /** A buyer return put the unit back into inventory: its cost isn't this sale's COGS any more. */
  restocked?: boolean
  /** Fees the marketplace gave back on a buyer return. */
  feeCreditCents?: number
  /** Postage for the buyer's return. */
  returnLabelCents?: number
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
  const charged = revenue > 0 ? Math.round(revenue * (s.feePct ?? 0)) + (s.feeFixedCents ?? 0) : 0
  const fees = Math.max(0, charged - (s.feeCreditCents ?? 0))
  const cog = s.restocked ? 0 : s.costCents * qty
  const shipping = (s.labelCostCents ?? 0) + (s.returnLabelCents ?? 0)
  const net = revenue - fees - shipping - cog - (s.refundCents ?? 0)
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
    refundCents: i.refund_cents ?? 0,
    restocked: !!i.restocked,
    feeCreditCents: i.fee_credit_cents ?? 0,
    returnLabelCents: i.return_label_cents ?? 0,
  })
}

/** What the store didn't give back, unit cost × units, plus what the return cost. */
export function storeRefundCents(i: Pick<Item, "cost_cents" | "quantity" | "store_refund_cents">): number {
  return i.store_refund_cents ?? i.cost_cents * i.quantity
}

/**
 * Money lost taking stock back to the store: cost − refund + return cost. A full, free refund is 0
 * (rows returned before refunds were recorded count that way). Never negative: a store can't refund
 * more than was paid as far as the books go.
 */
export function returnLoss(i: Pick<Item, "status" | "cost_cents" | "quantity" | "store_refund_cents" | "return_cost_cents">): number {
  if (i.status !== "returned") return 0
  return Math.max(0, i.cost_cents * i.quantity - storeRefundCents(i)) + (i.return_cost_cents ?? 0)
}

export type Summary = {
  net: number
  revenue: number
  cogSold: number
  fees: number
  salesCount: number
  /** Sales whose cost the seller hasn't entered: their profit counts the cost as $0, so net is too high. */
  unknownCostSales: number
  avgProfit: number
  margin: number
  inventoryValue: number
  inventoryUnits: number
  inventoryItems: number
  totalItems: number
  /** Restocking fees and other return costs for stock taken back in the range (already in net). */
  returnLosses: number
  best: { item: Item; sale: SaleBreakdown } | null
}

/** Sales are filtered by sold_at within range; inventory is always a current snapshot. */
export function summarize(items: Item[], range: Range, now = new Date()): Summary {
  let net = 0, revenue = 0, cogSold = 0, fees = 0, salesCount = 0, unknownCostSales = 0
  let inventoryValue = 0, inventoryUnits = 0, inventoryItems = 0, totalItems = 0, returnLosses = 0
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
      if (i.cost_unknown) unknownCostSales++
      // A sale with no cost entered would look like the best one just for missing its cost.
      else if (!best || s.net > best.sale.net) best = { item: i, sale: s }
    } else if (i.status === "returned" && inRange(i.returned_at, range, now)) {
      const loss = returnLoss(i)
      returnLosses += loss
      net -= loss
    }
  }

  return {
    net,
    revenue,
    cogSold,
    fees,
    salesCount,
    unknownCostSales,
    avgProfit: salesCount ? Math.round((net + returnLosses) / salesCount) : 0,
    margin: revenue ? net / revenue : 0,
    inventoryValue,
    inventoryUnits,
    inventoryItems,
    totalItems,
    returnLosses,
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
