import { describe, expect, it } from "vitest"
import { badgeAwards, badgeLabel, badgeMonthDue, initialsFrom, monthTotals, prevMonth, rank } from "./leaderboard"

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

describe("badges", () => {
  const t = (profit: number, itemsSold: number, miles: number) => ({ profit, itemsSold, miles })
  const rows = [
    { userId: "a", name: "AA", totals: t(5000, 1, 0) },
    { userId: "b", name: "BB", totals: t(9000, 4, 12.5) },
    { userId: "c", name: "CC", totals: t(100, 9, 3) },
    { userId: "d", name: "DD", totals: t(7000, 2, 0) },
  ]
  const oct = { year: 2026, month: 9 }
  it("awards the top 3 on each board, skipping zeros", () => {
    const awards = badgeAwards(rows, oct)
    expect(awards.filter((a) => a.board === "profit").map((a) => [a.userId, a.place])).toEqual([["b", 1], ["d", 2], ["a", 3]])
    expect(awards.filter((a) => a.board === "itemsSold").map((a) => a.userId)).toEqual(["c", "b", "d"])
    expect(awards.filter((a) => a.board === "miles").map((a) => a.userId)).toEqual(["b", "c"])
    expect(awards[0]).toMatchObject({ year: 2026, month: 9, name: "BB", value: 9000 })
  })
  it("is due for last month only in the first days of a month", () => {
    expect(badgeMonthDue(new Date("2026-11-01T13:00:00Z"))).toEqual(oct)
    expect(badgeMonthDue(new Date("2026-11-03T13:00:00Z"))).toEqual(oct)
    expect(badgeMonthDue(new Date("2026-11-04T13:00:00Z"))).toBeNull()
    expect(badgeMonthDue(new Date("2026-01-01T13:00:00Z"))).toEqual({ year: 2025, month: 11 })
  })
  it("labels a badge", () => {
    expect(badgeLabel({ year: 2026, month: 9, board: "profit", place: 1 })).toBe("#1 Profit · Oct 26")
  })
})
