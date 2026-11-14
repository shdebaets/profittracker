// Weekly profit recap: this week's numbers against last week's. Pure.
import { itemSale } from "./profit"
import { salePlatform, TAX_PLATFORM_LABELS } from "./tax"
import type { Expense, Item } from "./types"

export type Week = { from: Date; to: Date }

/** The 7 days ending at `end` (exclusive) and the 7 before that. */
export function lastTwoWeeks(end: Date): { week: Week; prev: Week } {
  const day = 86_400_000
  const to = new Date(end)
  const from = new Date(to.getTime() - 7 * day)
  return { week: { from, to }, prev: { from: new Date(from.getTime() - 7 * day), to: from } }
}

// The Sunday recap covers a fixed week, so its link can open exactly that week again.
// Weeks end at midnight US Eastern (05:00 UTC, standard time), because nearly every seller is in the US.
const DAY = 86_400_000
const WEEK_END_UTC_HOUR = 5

/** "YYYY-MM-DD" of the most recent week end at or before `now` (a Sunday when the cron runs on Sunday). */
export function recapWeekKey(now: Date): string {
  return new Date(now.getTime() - WEEK_END_UTC_HOUR * 3_600_000).toISOString().slice(0, 10)
}

/** The week ending on `key` ("YYYY-MM-DD", the day after its last day) and the week before; null if `key` isn't a date. */
export function weeksEnding(key: string): { week: Week; prev: Week } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const to = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), WEEK_END_UTC_HOUR))
  if (Number.isNaN(to.getTime()) || to.toISOString().slice(0, 10) !== key) return null
  return lastTwoWeeks(to)
}

/** "Nov 8 – Nov 14": the days a week covers. */
export function weekLabel(w: Week): string {
  const f = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  return `${f(w.from)} – ${f(new Date(w.to.getTime() - DAY))}`
}

const inWeek = (iso: string | null | undefined, w: Week) => !!iso && new Date(iso) >= w.from && new Date(iso) < w.to

export type WeekNumbers = {
  profit: number
  revenue: number
  itemsSold: number
  miles: number
  mileageWriteOff: number
  topItem: { title: string; profit: number } | null
  bestPlatform: { label: string; profit: number } | null
}

export function weekNumbers(items: Item[], expenses: Expense[], w: Week): WeekNumbers {
  let profit = 0, revenue = 0, itemsSold = 0, miles = 0, mileageWriteOff = 0
  let topItem: WeekNumbers["topItem"] = null
  const byPlatform = new Map<string, number>()
  for (const i of items) {
    if (i.status !== "sold" || !inWeek(i.sold_at, w)) continue
    const s = itemSale(i)
    profit += s.net
    revenue += s.revenue
    itemsSold += i.quantity
    if (!i.cost_unknown && (!topItem || s.net > topItem.profit)) topItem = { title: i.title || `Item #${i.seq}`, profit: s.net }
    const label = TAX_PLATFORM_LABELS[salePlatform(i)]
    byPlatform.set(label, (byPlatform.get(label) ?? 0) + s.net)
  }
  for (const e of expenses) {
    if (e.kind !== "mileage" || !inWeek(e.spent_at, w)) continue
    miles += Number(e.miles ?? 0)
    mileageWriteOff += e.amount_cents
  }
  let bestPlatform: WeekNumbers["bestPlatform"] = null
  for (const [label, p] of byPlatform) if (!bestPlatform || p > bestPlatform.profit) bestPlatform = { label, profit: p }
  return { profit, revenue, itemsSold, miles: Math.round(miles * 10) / 10, mileageWriteOff, topItem, bestPlatform }
}

/** Nothing happened in either week: skip the email. */
export const quietWeek = (a: WeekNumbers, b: WeekNumbers) => a.itemsSold + b.itemsSold === 0 && a.miles + b.miles === 0
