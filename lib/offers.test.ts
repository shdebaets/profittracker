import { describe, expect, it } from "vitest"
import { offerPrice } from "./offers"

const rule = { discount_pct: 10, max_discount_pct: 20, floor_margin_pct: 20, min_age_days: 7, every_days: 3 }

describe("offerPrice", () => {
  it("waits until the listing is old enough", () => {
    expect(offerPrice(5000, 1000, 3, rule)).toBeNull()
  })
  it("starts at the base discount and deepens weekly up to the max", () => {
    expect(offerPrice(5000, 1000, 7, rule)).toEqual({ cents: 4500, pct: 10 })
    expect(offerPrice(5000, 1000, 7 + 21, rule)).toEqual({ cents: 4350, pct: 13 })
    expect(offerPrice(5000, 1000, 400, rule)).toEqual({ cents: 4000, pct: 20 })
  })
  it("never goes below cost plus the floor margin", () => {
    expect(offerPrice(5000, 4000, 30, rule)).toBeNull() // floor 4800 is under 5% off
    expect(offerPrice(5000, 3700, 30, rule)).toEqual({ cents: 4440, pct: 11 })
  })
})
