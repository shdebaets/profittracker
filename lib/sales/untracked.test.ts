import { describe, expect, it } from "vitest"
import type { EbaySaleLine } from "@/lib/marketplaces/ebay/mapping"
import { calcSale } from "@/lib/profit"
import { ebaySoldItem, isItemId, marketplaceSoldItem, planUntrackedSales, type MarketplaceSale } from "./untracked"

const USER = "11111111-1111-4111-8111-111111111111"

const line: EbaySaleLine = {
  orderId: "12-34",
  lineItemId: "10001",
  sku: null,
  title: "Levi's 501 Jeans",
  listingId: "1234567890",
  quantity: 2,
  salePriceCents: 2500,
  buyerShippingCents: 800,
  feeCents: 760,
  soldAt: "2026-11-01T15:30:00.000Z",
}

describe("isItemId", () => {
  it("only treats FlipLedger item ids as ours", () => {
    expect(isItemId("2b7f3c9e-1d2a-4c5b-9e8f-0a1b2c3d4e5f")).toBe(true)
    expect(isItemId("JEANS-32")).toBe(false)
    expect(isItemId(null)).toBe(false)
  })
})

describe("ebaySoldItem", () => {
  it("makes a sold item with an unknown cost from the order line", () => {
    expect(ebaySoldItem(line, USER)).toEqual({
      user_id: USER,
      title: "Levi's 501 Jeans",
      status: "sold",
      quantity: 2,
      cost_cents: 0,
      cost_unknown: true,
      purchased_at: line.soldAt,
      link_url: "https://www.ebay.com/itm/1234567890",
      sale_price_cents: 2500,
      buyer_shipping_cents: 800,
      label_cost_cents: 0,
      fee_pct: 0,
      fee_fixed_cents: 760,
      platform: "ebay",
      sold_at: line.soldAt,
    })
  })

  it("names untitled lines after the eBay item or order", () => {
    expect(ebaySoldItem({ ...line, title: "" }, USER).title).toBe("eBay item 1234567890")
    expect(ebaySoldItem({ ...line, title: "", listingId: null }, USER)).toMatchObject({ title: "eBay order 12-34", link_url: null })
  })

  it("profit updates once the seller enters a cost", () => {
    const row = ebaySoldItem(line, USER)
    const sale = (costCents: number) =>
      calcSale({
        costCents, salePriceCents: row.sale_price_cents, quantity: row.quantity,
        buyerShippingCents: row.buyer_shipping_cents, feeFixedCents: row.fee_fixed_cents,
      })
    // revenue 2×25 + 8 = 58, fees 7.60
    expect(sale(0).net).toBe(5040)
    expect(sale(1000).net).toBe(3040)
  })
})

const sale = (id: string, extra: Partial<MarketplaceSale> = {}): MarketplaceSale => ({
  marketplace: "mercari",
  externalId: id,
  url: `https://www.mercari.com/us/item/${id}/`,
  title: "Jacket",
  priceCents: 4000,
  soldAt: "2026-11-02T10:00:00.000Z",
  photoUrl: null,
  ...extra,
})

describe("planUntrackedSales", () => {
  it("skips recorded sales and tracked listings, and doubles", () => {
    const plan = planUntrackedSales([sale("m1"), sale("m2"), sale("m3"), sale("m3")], {
      listings: [
        { marketplace: "mercari", external_url: "https://www.mercari.com/us/item/m2/" },
        { marketplace: "poshmark", external_url: "https://poshmark.com/listing/x-6ae39b435ac6f2cd42f32233" },
      ],
      recorded: ["m1"],
    })
    expect(plan.create.map((s) => s.externalId)).toEqual(["m3"])
    expect(plan.skip.map((s) => s.externalId)).toEqual(["m1", "m2"])
  })
})

describe("marketplaceSoldItem", () => {
  const now = new Date("2026-11-12T12:00:00.000Z")

  it("records one unit at the page price with Mercari's fee", () => {
    expect(marketplaceSoldItem(sale("m9"), USER, now)).toMatchObject({
      user_id: USER, title: "Jacket", status: "sold", quantity: 1, cost_cents: 0, cost_unknown: true,
      sale_price_cents: 4000, fee_pct: 0.1, platform: "mercari_depop",
      link_url: "https://www.mercari.com/us/item/m9/", sold_at: "2026-11-02T10:00:00.000Z",
    })
  })

  it("uses now when the sold date is missing or misread", () => {
    expect(marketplaceSoldItem(sale("m9", { soldAt: null }), USER, now).sold_at).toBe(now.toISOString())
    expect(marketplaceSoldItem(sale("m9", { soldAt: "2030-01-01T00:00:00Z" }), USER, now).sold_at).toBe(now.toISOString())
    expect(marketplaceSoldItem(sale("m9", { soldAt: "1970-01-01T00:00:00Z" }), USER, now).sold_at).toBe(now.toISOString())
  })
})
