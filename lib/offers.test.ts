import { describe, expect, it } from "vitest"
import { lastSentByListing, offerDue, offerPrice } from "./offers"

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

describe("offerDue (per listing)", () => {
  const now = new Date("2026-11-14T13:00:00Z")
  it("is due with no earlier offer, or once every_days have passed (with an hour of cron slack)", () => {
    expect(offerDue(undefined, 3, now)).toBe(true)
    expect(offerDue("2026-11-12T13:00:00Z", 3, now)).toBe(false)
    expect(offerDue("2026-11-11T13:00:00Z", 3, now)).toBe(true)
    expect(offerDue("2026-11-13T13:20:00Z", 1, now)).toBe(true) // yesterday's cron ran a bit later
  })
  it("tracks each listing on its own", () => {
    const last = lastSentByListing([
      { listing_id: "a", sent_at: "2026-11-13T13:00:00Z" },
      { listing_id: "a", sent_at: "2026-11-01T13:00:00Z" },
      { listing_id: "b", sent_at: "2026-11-01T13:00:00Z" },
    ])
    expect(offerDue(last.get("a"), 3, now)).toBe(false)
    expect(offerDue(last.get("b"), 3, now)).toBe(true)
    expect(offerDue(last.get("c"), 3, now)).toBe(true)
  })
})
