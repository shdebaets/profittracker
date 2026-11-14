import { describe, expect, it } from "vitest"
import { buildHistory } from "./history"

describe("buildHistory", () => {
  it("makes one row per day with sales, median and the day's last live snapshot", () => {
    const now = new Date("2026-11-14T20:00:00Z")
    const sale = (d: string, c: number, ship: number | null = 0, bo = false) => ({ priceCents: c, shippingCents: ship, soldOn: d, bestOffer: bo })
    const h = buildHistory(
      [sale("2026-11-14", 36000), sale("2026-11-14", 38000), sale("2026-11-14", 55000, 0, true), sale("2026-11-13", 47000, 6000)],
      [
        { taken_at: "2026-11-14T10:00:00Z", live_count: 500, lowest_cents: 35000 },
        { taken_at: "2026-11-14T18:00:00Z", live_count: 465, lowest_cents: 34499 },
      ],
      now,
      3,
    )
    expect(h.map((d) => d.day)).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"])
    expect(h[2]).toEqual({ day: "2026-11-14", sold: 3, soldMedian: 37000, live: 465, lowest: 34499 })
    // An overseas sale counts as a sale but has no US price.
    expect(h[1]).toEqual({ day: "2026-11-13", sold: 1, soldMedian: null, live: null, lowest: null })
  })
})
