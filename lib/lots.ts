// Lot (haul) ROI: what a lot cost and what its items have brought back so far. Pure.
import { itemSale } from "./profit"
import type { Item } from "./types"

export type Haul = {
  id: string
  title: string | null
  store: string | null
  total_cents: number
  purchased_at: string
  receipt_path: string | null
  split_mode: "even" | "value"
}

export type LotStats = {
  units: number
  unitsSold: number
  unitsLeft: number
  /** Money back from sales after fees and shipping labels (before the lot's cost). */
  returned: number
  /** returned − what the whole lot cost. */
  profit: number
  roi: number
  /** Cost of the units still in stock. */
  stockCost: number
}

export function lotStats(haul: Haul, items: Item[]): LotStats {
  let units = 0, unitsSold = 0, unitsLeft = 0, returned = 0, stockCost = 0
  for (const i of items) {
    if (i.haul_id !== haul.id) continue
    units += i.quantity
    if (i.status === "sold") {
      const s = itemSale(i)
      unitsSold += i.quantity
      returned += s.revenue - s.fees - s.shipping
    } else if (i.status === "inventory") {
      unitsLeft += i.quantity
      stockCost += i.cost_cents * i.quantity
    }
  }
  const profit = returned - haul.total_cents
  return { units, unitsSold, unitsLeft, returned, profit, roi: haul.total_cents ? profit / haul.total_cents : 0, stockCost }
}
