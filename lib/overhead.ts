import { inRange, rangeStart, type Range } from "./dates"
import type { Expense, Subscription } from "./types"

/** Whole months billed from start date through now (inclusive of the start month). */
function monthsBilled(startedAt: string, now: Date): number {
  const [y, m] = startedAt.split("-").map(Number)
  return Math.max(1, (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m) + 1)
}

/**
 * Subscription cost attributable to a range. Active subs only.
 * all: every month since start; month: one month; week/today: prorated by day (÷30).
 */
export function subscriptionCost(subs: Subscription[], range: Range, now = new Date()): number {
  let total = 0
  for (const s of subs) {
    if (!s.active) continue
    if (range === "all") total += s.amount_cents * monthsBilled(s.started_at, now)
    else if (range === "month") total += s.amount_cents
    else {
      const days = range === "today" ? 1 : Math.floor((now.getTime() - rangeStart(range, now)!.getTime()) / 86_400_000) + 1
      total += Math.round((s.amount_cents * days) / 30)
    }
  }
  return total
}

export function expenseTotals(expenses: Expense[], range: Range, now = new Date()) {
  let expenseCents = 0, mileageCents = 0, miles = 0, trips = 0
  for (const e of expenses) {
    if (!inRange(e.spent_at, range, now)) continue
    if (e.kind === "mileage") {
      mileageCents += e.amount_cents
      miles += Number(e.miles ?? 0)
      trips++
    } else expenseCents += e.amount_cents
  }
  return { expenseCents, mileageCents, miles, trips, total: expenseCents + mileageCents }
}
