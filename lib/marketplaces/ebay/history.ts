// Past eBay sales (tracker row 81): the regular sync only reads orders created after the
// seller connected eBay, so older sales never showed up and Sync said "No new sales".
// This plans a one-off import of the last ~90 days. Pure: no I/O.
import { isItemId } from "@/lib/sales/untracked"
import type { EbaySaleLine } from "./mapping"

/** eBay's Fulfillment API returns orders up to 90 days old; stay a day inside that. */
export const HISTORY_DAYS = 89
/** A hand-logged sale this close in time with the same price is treated as the same sale. */
export const DUPLICATE_WINDOW_DAYS = 3
/** Lines recorded per server call, so a big seller doesn't hit the function time limit. */
export const HISTORY_BATCH = 150

export const historySince = (now = Date.now()) => new Date(now - HISTORY_DAYS * 86_400_000)

/** A sold item the seller entered themselves (not created by a marketplace sync). */
export type HandSale = { sale_price_cents: number | null; sold_at: string | null }

export type HistoryPlan = {
  create: EbaySaleLine[]
  /** Already in FlipLedger from an earlier sync or import. */
  recorded: number
  /** Listed through FlipLedger: the regular sync handles those. */
  tracked: number
  /** Same price within a few days of a sale the seller logged by hand: left out so it isn't counted twice. */
  likelyLogged: EbaySaleLine[]
}

export function planEbayHistory(lines: EbaySaleLine[], existing: { recorded: Iterable<string>; handSales: HandSale[] }): HistoryPlan {
  const recorded = new Set(existing.recorded)
  // Each hand-logged sale can explain one eBay line at most.
  const hand = existing.handSales
    .filter((h) => h.sale_price_cents != null && h.sold_at)
    .map((h) => ({ price: h.sale_price_cents as number, at: new Date(h.sold_at as string).getTime(), used: false }))
  const plan: HistoryPlan = { create: [], recorded: 0, tracked: 0, likelyLogged: [] }
  const seen = new Set<string>()
  const window = DUPLICATE_WINDOW_DAYS * 86_400_000
  const sorted = [...lines].sort((a, b) => new Date(a.soldAt).getTime() - new Date(b.soldAt).getTime())
  for (const line of sorted) {
    if (seen.has(line.lineItemId)) continue
    seen.add(line.lineItemId)
    if (recorded.has(line.lineItemId)) {
      plan.recorded++
      continue
    }
    if (isItemId(line.sku)) {
      plan.tracked++
      continue
    }
    const at = new Date(line.soldAt).getTime()
    const match = hand.find((h) => !h.used && h.price === line.salePriceCents && Math.abs(h.at - at) <= window)
    if (match) {
      match.used = true
      plan.likelyLogged.push(line)
      continue
    }
    plan.create.push(line)
  }
  return plan
}

/** Toast after "Sync sales now" finds nothing new on eBay. */
export function noNewEbaySalesMessage(since: string | null, connectedAt: string, fmt: (iso: string) => string): string {
  const from = since ?? connectedAt
  return `No new eBay sales since ${fmt(from)}. FlipLedger brings in eBay sales made after you connected eBay (${fmt(connectedAt)}). For older ones, use "Bring in past eBay sales" in Settings → Marketplaces.`
}
