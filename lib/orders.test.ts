import { describe, expect, it } from "vitest"
import { filterOrders, isToShip, orderInfo, type Order } from "./orders"
import type { Listing } from "./types"

const NOW = new Date("2026-11-12T12:00:00Z")

const order = (o: Partial<Order>): Order => ({
  id: "i", seq: 1, title: "t", status: "sold", quantity: 1, cost_cents: 0, cost_unknown: false,
  purchased_at: "2026-10-01T00:00:00Z", store: null, link_url: null, haul_id: null,
  sale_price_cents: 1000, buyer_shipping_cents: 0, label_cost_cents: 0, fee_pct: 0, fee_fixed_cents: 0,
  platform: "ebay", sold_at: "2026-11-10T00:00:00Z", returnable: false, return_deadline: null,
  photo_paths: [], photo_urls: [], description: null, condition: null, brand: null, size: null,
  list_price_cents: null, category: null, sold_on: null, shipped_at: null, listings: [],
  created_at: "2026-10-01T00:00:00Z", sales: [],
  ...o,
})

const listing = (l: Partial<Listing>) => ({ id: "l", marketplace: "poshmark", status: "sold", external_url: null, ...l }) as Listing

describe("orderInfo", () => {
  it("links eBay sales to the order page and carries buyer and ship-by", () => {
    const o = order({
      sold_on: "ebay",
      sales: [{ marketplace: "ebay", external_order_id: "12-34", buyer: "sneakerfan22", ship_by: "2026-11-11T06:59:59Z", order_status: "NOT_STARTED" }],
    })
    expect(orderInfo(o, NOW)).toEqual({
      soldOn: "ebay",
      buyer: "sneakerfan22",
      shipBy: "2026-11-11T06:59:59Z",
      late: true,
      url: "https://www.ebay.com/sh/ord/details?orderid=12-34",
    })
  })

  it("is not late once shipped, or before the ship-by date", () => {
    const sale = { marketplace: "ebay" as const, external_order_id: "1", buyer: null, ship_by: "2026-11-11T00:00:00Z", order_status: null }
    expect(orderInfo(order({ shipped_at: "2026-11-11T09:00:00Z", sales: [sale] }), NOW).late).toBe(false)
    expect(orderInfo(order({ sales: [{ ...sale, ship_by: "2026-11-14T00:00:00Z" }] }), NOW).late).toBe(false)
  })

  it("falls back to the sold listing, then the item's own link", () => {
    const posh = order({ sold_on: "poshmark", link_url: "https://example.com", listings: [listing({ external_url: "https://poshmark.com/listing/x-1" })] })
    expect(orderInfo(posh, NOW)).toMatchObject({ soldOn: "poshmark", url: "https://poshmark.com/listing/x-1", buyer: null })
    expect(orderInfo(order({ link_url: "https://example.com" }), NOW).url).toBe("https://example.com")
    expect(orderInfo(order({}), NOW)).toMatchObject({ soldOn: null, url: null, late: false })
  })

  it("uses the recorded sale's marketplace when sold_on is missing", () => {
    const o = order({ sales: [{ marketplace: "mercari", external_order_id: null, buyer: null, ship_by: null, order_status: null }] })
    expect(orderInfo(o, NOW).soldOn).toBe("mercari")
  })
})

describe("filterOrders", () => {
  const a = order({ id: "a", sold_at: "2026-11-01T00:00:00Z" })
  const b = order({ id: "b", sold_at: "2026-11-05T00:00:00Z", sales: [{ marketplace: "ebay", external_order_id: "2", buyer: null, ship_by: "2026-11-08T00:00:00Z", order_status: null }] })
  const c = order({ id: "c", sold_at: "2026-11-09T00:00:00Z", shipped_at: "2026-11-10T00:00:00Z" })

  it("to ship: unshipped only, most urgent ship-by first, then oldest sale", () => {
    expect(filterOrders([a, b, c], "to_ship").map((o) => o.id)).toEqual(["b", "a"])
  })

  it("shipped and all: newest sale first", () => {
    expect(filterOrders([a, b, c], "shipped").map((o) => o.id)).toEqual(["c"])
    expect(filterOrders([a, b, c], "all").map((o) => o.id)).toEqual(["c", "b", "a"])
  })

  it("only sold, unshipped items are to ship", () => {
    expect(isToShip({ status: "sold", shipped_at: null })).toBe(true)
    expect(isToShip({ status: "returned", shipped_at: null })).toBe(false)
  })
})
