import { describe, expect, it } from "vitest"
import { offerReport, settleOffers, type OpenOffer, type SaleLine } from "./offers-settle"

const now = new Date("2026-11-14T12:00:00Z")
const offer: OpenOffer = { id: "o1", userId: "u1", itemId: "i1", listingId: "ebay-123", marketplace: "ebay", sentAt: "2026-11-12T12:00:00Z", offerCents: 4500 }
const sale: SaleLine = { marketplace: "ebay", lineId: "line-1", userId: "u1", itemId: "i1", unitCents: 4500, quantity: 1, soldAt: "2026-11-13T09:00:00Z" }

describe("settleOffers", () => {
  it("credits the real eBay sale and its amount", () => {
    const [s] = settleOffers([offer], [{ ...sale, quantity: 2 }], new Set(), now)
    expect(s).toMatchObject({ offerId: "o1", outcome: "sold", saleCents: 9000 })
    expect(s.outcome === "sold" && s.sale.lineId).toBe("line-1")
  })
  it("ignores sales before the offer, after the window, over the offer, other items or other sellers", () => {
    const misses: SaleLine[] = [
      { ...sale, soldAt: "2026-11-12T11:00:00Z" },
      { ...sale, soldAt: "2026-11-15T13:00:00Z" },
      { ...sale, unitCents: 4601 },
      { ...sale, itemId: "i2" },
      { ...sale, userId: "u2" },
      { ...sale, marketplace: "poshmark" },
    ]
    expect(settleOffers([offer], misses, new Set(), now)).toEqual([])
  })
  it("allows a dollar over the offer", () => {
    expect(settleOffers([offer], [{ ...sale, unitCents: 4600 }], new Set(), now)[0].outcome).toBe("sold")
  })
  it("leaves offers open inside the window and expires them after it", () => {
    expect(settleOffers([offer], [], new Set(), now)).toEqual([])
    expect(settleOffers([offer], [], new Set(), new Date("2026-11-16T12:00:00Z"))).toEqual([{ offerId: "o1", outcome: "expired" }])
  })
  it("credits each sale once, to the latest offer before it", () => {
    const older = { ...offer, id: "o0", sentAt: "2026-11-11T12:00:00Z" }
    const out = settleOffers([older, offer], [sale], new Set(), new Date("2026-11-20T00:00:00Z"))
    expect(out).toContainEqual(expect.objectContaining({ offerId: "o1", outcome: "sold" }))
    expect(out).toContainEqual({ offerId: "o0", outcome: "expired" })
    expect(settleOffers([offer], [sale], new Set(["ebay:line-1"]), now)).toEqual([])
  })
  it("matches assisted offers to the recorded sale of that listing", () => {
    const posh: OpenOffer = { ...offer, marketplace: "poshmark", listingId: "listing-row-1" }
    const poshSale: SaleLine = { ...sale, marketplace: "poshmark", lineId: "listing-row-1" }
    expect(settleOffers([posh], [poshSale], new Set(), now)[0].outcome).toBe("sold")
    expect(settleOffers([posh], [{ ...poshSale, lineId: "other-listing" }], new Set(), now)).toEqual([])
  })
  it("skips sales with no known amount", () => {
    expect(settleOffers([offer], [{ ...sale, unitCents: null }], new Set(), now)).toEqual([])
  })
})

describe("offerReport", () => {
  it("counts sent, sold and the revenue from real sales", () => {
    const r = offerReport([
      { error: null, outcome: "sold", sale_cents: 4500 },
      { error: null, outcome: "sold", sale_cents: 9000 },
      { error: null, outcome: "expired", sale_cents: null },
      { error: null, outcome: null, sale_cents: null },
      { error: "boom", outcome: null, sale_cents: null },
    ])
    expect(r).toEqual({ sent: 4, accepted: 2, revenueCents: 13500, acceptRate: 67 })
  })
})
