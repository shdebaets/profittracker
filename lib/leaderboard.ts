// Monthly leaderboard math. Pure.
import { itemSale } from "./profit"
import type { Expense, Item } from "./types"

export type Month = { year: number; month: number } // month 0-11

export const monthRange = (m: Month) => ({ from: new Date(Date.UTC(m.year, m.month, 1)), to: new Date(Date.UTC(m.year, m.month + 1, 1)) })
export const monthLabel = (m: Month) => new Date(Date.UTC(m.year, m.month, 15)).toLocaleString("en-US", { month: "long", timeZone: "UTC" })
export const prevMonth = (m: Month): Month => (m.month === 0 ? { year: m.year - 1, month: 11 } : { year: m.year, month: m.month - 1 })
export const monthOf = (d: Date): Month => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() })

export type MonthTotals = { profit: number; itemsSold: number; miles: number }

export function monthTotals(items: Pick<Item, "status" | "sold_at" | "quantity" | "sale_price_cents" | "buyer_shipping_cents" | "label_cost_cents" | "fee_pct" | "fee_fixed_cents" | "cost_cents">[], trips: Pick<Expense, "kind" | "spent_at" | "miles">[], m: Month): MonthTotals {
  const { from, to } = monthRange(m)
  const inMonth = (iso: string | null) => !!iso && new Date(iso) >= from && new Date(iso) < to
  let profit = 0, itemsSold = 0, miles = 0
  for (const i of items) {
    if (i.status !== "sold" || !inMonth(i.sold_at)) continue
    profit += itemSale(i as Item).net
    itemsSold += i.quantity
  }
  for (const t of trips) if (t.kind === "mileage" && inMonth(t.spent_at)) miles += Number(t.miles ?? 0)
  return { profit, itemsSold, miles: Math.round(miles * 10) / 10 }
}

export type Board = "profit" | "itemsSold" | "miles"

export function rank<T extends { totals: MonthTotals }>(rows: T[], board: Board): (T & { place: number })[] {
  return [...rows]
    .filter((r) => r.totals[board] > 0)
    .sort((a, b) => b.totals[board] - a.totals[board])
    .map((r, i) => ({ ...r, place: i + 1 }))
}

/** Initials from an email's name part: "nick.layon@x.com" → "NL". */
export function initialsFrom(email: string) {
  const parts = email.split("@")[0].split(/[._\-+0-9]+/).filter(Boolean)
  return (parts.slice(0, 2).map((p) => p[0]).join("") || "FL").toUpperCase()
}
