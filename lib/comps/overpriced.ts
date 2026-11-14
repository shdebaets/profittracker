// Overpriced alerts: inventory priced well above what the same thing recently sold for. Pure.
import { askingPrice } from "@/lib/stale"
import type { Item } from "@/lib/types"

export const OVERPRICED_RATIO = 1.25

export type Overpriced = { itemId: string; title: string; priceCents: number; soldMedianCents: number; overBy: number }

/** `medians` maps an item id to the sold median found for its title. */
export function overpricedItems(items: Item[], medians: Map<string, number>): Overpriced[] {
  const out: Overpriced[] = []
  for (const i of items) {
    if (i.status !== "inventory") continue
    const price = askingPrice(i)
    const med = medians.get(i.id)
    if (price == null || !med) continue
    if (price >= med * OVERPRICED_RATIO) {
      out.push({ itemId: i.id, title: i.title ?? `Item #${i.seq}`, priceCents: price, soldMedianCents: med, overBy: price / med - 1 })
    }
  }
  return out.sort((a, b) => b.overBy - a.overBy)
}
