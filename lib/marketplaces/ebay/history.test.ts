import { describe, expect, it } from "vitest"
import { historySince, noNewEbaySalesMessage, planEbayHistory } from "./history"
import type { EbaySaleLine } from "./mapping"
import { EbayError, isDeadRefreshToken } from "./client"

const line = (id: string, over: Partial<EbaySaleLine> = {}): EbaySaleLine => ({
  orderId: `o-${id}`,
  lineItemId: id,
  sku: null,
  title: `Item ${id}`,
  listingId: "123",
  quantity: 1,
  salePriceCents: 2500,
  buyerShippingCents: 0,
  feeCents: 300,
  salesTaxCents: 0,
  soldAt: "2026-10-10T15:00:00Z",
  buyer: "buyer1",
  shipBy: null,
  fulfillment: "FULFILLED",
  ...over,
})

describe("planEbayHistory", () => {
  it("creates new lines and skips ones already recorded", () => {
    const p = planEbayHistory([line("a"), line("b", { salePriceCents: 999 })], { recorded: ["a"], handSales: [] })
    expect(p.recorded).toBe(1)
    expect(p.create.map((l) => l.lineItemId)).toEqual(["b"])
  })

  it("leaves FlipLedger listings to the regular sync", () => {
    const p = planEbayHistory([line("a", { sku: "3f2c1b9e-1111-4222-8333-944455556666" })], { recorded: [], handSales: [] })
    expect(p.tracked).toBe(1)
    expect(p.create).toHaveLength(0)
  })

  it("leaves out a line that matches a hand-logged sale (same price, within 3 days), once per hand sale", () => {
    const p = planEbayHistory([line("a"), line("b")], {
      recorded: [],
      handSales: [{ sale_price_cents: 2500, sold_at: "2026-10-12T10:00:00Z" }],
    })
    expect(p.likelyLogged.map((l) => l.lineItemId)).toEqual(["a"])
    expect(p.create.map((l) => l.lineItemId)).toEqual(["b"])
  })

  it("does not match a hand sale at a different price or more than 3 days away", () => {
    const p = planEbayHistory([line("a")], {
      recorded: [],
      handSales: [
        { sale_price_cents: 2400, sold_at: "2026-10-10T15:00:00Z" },
        { sale_price_cents: 2500, sold_at: "2026-10-20T15:00:00Z" },
        { sale_price_cents: null, sold_at: "2026-10-10T15:00:00Z" },
      ],
    })
    expect(p.create).toHaveLength(1)
    expect(p.likelyLogged).toHaveLength(0)
  })

  it("counts a repeated line once", () => {
    const p = planEbayHistory([line("a"), line("a")], { recorded: [], handSales: [] })
    expect(p.create).toHaveLength(1)
  })
})

describe("historySince", () => {
  it("is 89 days back, inside eBay's 90-day limit", () => {
    const now = Date.UTC(2026, 10, 27)
    expect((now - historySince(now).getTime()) / 86_400_000).toBe(89)
  })
})

describe("noNewEbaySalesMessage", () => {
  it("names the last sync and the connect date", () => {
    const m = noNewEbaySalesMessage("2026-11-20T00:00:00Z", "2026-11-01T00:00:00Z", (s) => s.slice(0, 10))
    expect(m).toContain("since 2026-11-20")
    expect(m).toContain("connected eBay (2026-11-01)")
    expect(m).toContain("Bring in past eBay sales")
  })
  it("falls back to the connect date before the first sync", () => {
    expect(noNewEbaySalesMessage(null, "2026-11-01T00:00:00Z", (s) => s.slice(0, 10))).toContain("since 2026-11-01")
  })
})

describe("isDeadRefreshToken", () => {
  it("is true only for eBay's 400 invalid_grant on a refresh", () => {
    expect(isDeadRefreshToken(new EbayError("the provided authorization refresh token is invalid or was issued to another client", 400))).toBe(true)
    expect(isDeadRefreshToken(new EbayError("invalid_grant", 400))).toBe(true)
    expect(isDeadRefreshToken(new EbayError("client authentication failed", 401))).toBe(false) // our app key, not the seller
    expect(isDeadRefreshToken(new EbayError("Internal error", 500))).toBe(false)
    expect(isDeadRefreshToken(new Error("fetch failed"))).toBe(false)
  })
})
