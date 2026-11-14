import { describe, expect, it } from "vitest"
import { dueOffers, type OfferCandidate } from "./offers-assisted"

const rule = { discount_pct: 10, max_discount_pct: 20, floor_margin_pct: 20, min_age_days: 7, every_days: 3 }
const now = new Date("2026-11-14T12:00:00Z")
const base: OfferCandidate = {
  listingId: "l1", itemId: "i1", marketplace: "poshmark", title: "Jacket", url: "https://poshmark.com/listing/x",
  listedAt: "2026-11-01T12:00:00Z", listPriceCents: 5000, costCents: 1000,
}

describe("dueOffers", () => {
  it("offers on old enough Poshmark and Mercari listings", () => {
    const [o] = dueOffers([base], new Map(), rule, now)
    expect(o.offerCents).toBe(4500)
    expect(o.pct).toBe(10)
  })
  it("skips eBay, young listings, and ones offered on recently", () => {
    expect(dueOffers([{ ...base, marketplace: "ebay" }], new Map(), rule, now)).toEqual([])
    expect(dueOffers([{ ...base, listedAt: "2026-11-12T12:00:00Z" }], new Map(), rule, now)).toEqual([])
    expect(dueOffers([base], new Map([["l1", "2026-11-13T12:00:00Z"]]), rule, now)).toEqual([])
    expect(dueOffers([base], new Map([["l1", "2026-11-10T12:00:00Z"]]), rule, now)).toHaveLength(1)
  })
  it("never goes under cost plus the floor margin", () => {
    expect(dueOffers([{ ...base, costCents: 4400 }], new Map(), rule, now)).toEqual([])
  })
})
