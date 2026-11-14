// Stale inventory: unsold items that have sat longer than the seller's threshold. Pure.
import type { Item } from "./types"

export const STALE_DAY_OPTIONS = [30, 45, 60, 90, 120] as const
export const DEFAULT_STALE_DAYS = 60

/** When the item started sitting: its first live listing, else when it was bought. */
export function sittingSince(i: Item): string {
  const listed = i.listings
    .filter((l) => l.status === "active" && l.listed_at)
    .map((l) => l.listed_at!)
    .sort()[0]
  return listed ?? i.purchased_at
}

export function daysSitting(i: Item, now = new Date()): number {
  return Math.floor((now.getTime() - new Date(sittingSince(i)).getTime()) / 86_400_000)
}

export function staleItems(items: Item[], days: number, now = new Date()): Item[] {
  return items.filter((i) => i.status === "inventory" && daysSitting(i, now) >= days)
}

export type PriceChange = { mode: "percent" | "amount" | "set"; value: number }

/**
 * New price in cents. percent: drop by value% (e.g. 15); amount: drop by value cents; set: exactly value cents.
 * Never below $0.99 (marketplaces reject $0) and rounds to whole cents.
 */
export function repriced(currentCents: number, c: PriceChange): number {
  const next =
    c.mode === "percent" ? Math.round(currentCents * (1 - c.value / 100))
    : c.mode === "amount" ? currentCents - Math.round(c.value)
    : Math.round(c.value)
  return Math.max(99, next)
}

/** The item's asking price: its list price, else its highest live listing price. */
export function askingPrice(i: Item): number | null {
  if (i.list_price_cents != null) return i.list_price_cents
  const prices = i.listings.filter((l) => l.status === "active" && l.price_cents != null).map((l) => l.price_cents!)
  return prices.length ? Math.max(...prices) : null
}
