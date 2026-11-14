import { describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }))
import { moneyCents, shippingCents, soldDate, toSoldRow } from "./sold-api"

describe("sold data parsing", () => {
  it("reads sold dates", () => {
    expect(soldDate("Sold Jul 28, 2026")).toBe("2026-07-28")
    expect(soldDate("Sold  3 Nov 2026")).toBe("2026-11-03")
    expect(soldDate("2026-10-01")).toBe("2026-10-01")
    expect(soldDate("Ended")).toBeNull()
  })
  it("reads money and shipping", () => {
    expect(moneyCents("$1,234.50")).toBe(123450)
    expect(moneyCents(539.99)).toBe(53999)
    expect(moneyCents({ value: 12 })).toBe(1200)
    expect(shippingCents("Free delivery")).toBe(0)
    expect(shippingCents("+$5.99 delivery")).toBe(599)
    expect(shippingCents(null)).toBeNull()
  })
  it("turns a result into a row", () => {
    const r = toSoldRow({
      title: "Apple iPhone 15 Pro Max 256GB",
      price: 539.99,
      currency: "USD",
      caption: "Sold Jul 28, 2026",
      condition: "Pre-Owned",
      shipping: "Free delivery",
      product_url: "https://www.ebay.com/itm/326512345678?hash=x",
    })
    expect(r).toEqual({
      external_id: "326512345678",
      title: "Apple iPhone 15 Pro Max 256GB",
      price_cents: 53999,
      shipping_cents: 0,
      sold_on: "2026-07-28",
      best_offer: false,
      condition: "Pre-Owned",
    })
  })
  it("skips unpriced, undated or non-USD results and makes a stable id when none is given", () => {
    expect(toSoldRow({ title: "x", price: 10, caption: "Ended" })).toBeNull()
    expect(toSoldRow({ title: "x", price: 10, currency: "GBP", caption: "Sold Jul 1, 2026" })).toBeNull()
    const a = toSoldRow({ title: "x", price: 10, caption: "Sold Jul 1, 2026" })!
    expect(a.external_id).toMatch(/^h[0-9a-f]{14}$/)
    expect(toSoldRow({ title: "x", price: 10, caption: "Sold Jul 1, 2026" })!.external_id).toBe(a.external_id)
  })
})
