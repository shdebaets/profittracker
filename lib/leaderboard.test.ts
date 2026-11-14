import { describe, expect, it } from "vitest"
import { initialsFrom, monthTotals, prevMonth, rank } from "./leaderboard"

describe("leaderboard", () => {
  const base = { status: "sold", quantity: 1, buyer_shipping_cents: 0, label_cost_cents: 0, fee_pct: 0, fee_fixed_cents: 0 }
  it("totals one month", () => {
    const items = [
      { ...base, sold_at: "2026-10-05T12:00:00Z", sale_price_cents: 5000, cost_cents: 1000 },
      { ...base, sold_at: "2026-11-01T12:00:00Z", sale_price_cents: 9000, cost_cents: 0 },
    ] as never[]
    const trips = [{ kind: "mileage", spent_at: "2026-10-09T12:00:00Z", miles: 12.4 }] as never[]
    expect(monthTotals(items, trips, { year: 2026, month: 9 })).toEqual({ profit: 4000, itemsSold: 1, miles: 12.4 })
  })
  it("ranks and drops zeros", () => {
    const rows = [{ id: "a", totals: { profit: 10, itemsSold: 1, miles: 0 } }, { id: "b", totals: { profit: 30, itemsSold: 0, miles: 2 } }]
    expect(rank(rows, "profit").map((r) => [r.id, r.place])).toEqual([["b", 1], ["a", 2]])
    expect(rank(rows, "miles").map((r) => r.id)).toEqual(["b"])
  })
  it("months and initials", () => {
    expect(prevMonth({ year: 2026, month: 0 })).toEqual({ year: 2025, month: 11 })
    expect(initialsFrom("nick.layon@gmail.com")).toBe("NL")
    expect(initialsFrom("emoneyhq1@gmail.com")).toBe("E")
  })
})
