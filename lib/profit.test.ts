import { describe, expect, it } from "vitest"
import { calcSale, distributeHaul, mileageDeduction, presetFor, summarize } from "./profit"
import { toCents } from "./money"
import type { Item } from "./types"

const base: Item = {
  id: "x", seq: 1, title: "t", status: "sold", quantity: 1, cost_cents: 1000,
  purchased_at: "2026-09-01T12:00:00Z", store: null, link_url: null, haul_id: null,
  sale_price_cents: 5000, buyer_shipping_cents: 0, label_cost_cents: 0, fee_pct: 0,
  fee_fixed_cents: 0, platform: "cash", sold_at: "2026-09-20T12:00:00Z",
  returnable: false, return_deadline: null, created_at: "2026-09-01T12:00:00Z",
}

describe("calcSale", () => {
  it("cash sale is price minus cost", () => {
    const s = calcSale({ costCents: 1000, salePriceCents: 5000, quantity: 1 })
    expect(s).toMatchObject({ revenue: 5000, fees: 0, net: 4000, margin: 0.8 })
  })

  it("eBay 13.25% applies to price + buyer shipping, label cost subtracted", () => {
    const ebay = presetFor("ebay")
    const s = calcSale({
      costCents: 1500, salePriceCents: 4000, quantity: 2,
      buyerShippingCents: 800, labelCostCents: 950, feePct: ebay.pct,
    })
    // revenue 8800, fees round(1166) = 1166, cog 3000, ship 950
    expect(s.revenue).toBe(8800)
    expect(s.fees).toBe(1166)
    expect(s.net).toBe(8800 - 1166 - 950 - 3000)
  })

  it("card fee adds the fixed 30c", () => {
    const card = presetFor("card")
    const s = calcSale({ costCents: 0, salePriceCents: 10000, quantity: 1, feePct: card.pct, feeFixedCents: card.fixedCents })
    expect(s.fees).toBe(290 + 30)
  })

  it("zero revenue has no fees and zero margin", () => {
    const s = calcSale({ costCents: 500, salePriceCents: 0, quantity: 1, feeFixedCents: 30 })
    expect(s.fees).toBe(0)
    expect(s.margin).toBe(0)
  })
})

describe("summarize", () => {
  const now = new Date("2026-09-25T12:00:00")
  const items: Item[] = [
    { ...base, id: "a", sold_at: "2026-09-25T09:00:00" },
    { ...base, id: "b", sale_price_cents: 20000, sold_at: "2026-08-01T09:00:00" },
    { ...base, id: "c", status: "inventory", quantity: 5, cost_cents: 780, sold_at: null, sale_price_cents: null },
    { ...base, id: "d", status: "returned" },
  ]

  it("all-time totals", () => {
    const s = summarize(items, "all", now)
    expect(s.salesCount).toBe(2)
    expect(s.net).toBe(4000 + 19000)
    expect(s.inventoryValue).toBe(3900)
    expect(s.inventoryUnits).toBe(5)
    expect(s.best?.item.id).toBe("b")
    expect(s.totalItems).toBe(3)
  })

  it("today only counts today's sales, inventory stays a snapshot", () => {
    const s = summarize(items, "today", now)
    expect(s.salesCount).toBe(1)
    expect(s.net).toBe(4000)
    expect(s.inventoryValue).toBe(3900)
  })
})

describe("distributeHaul", () => {
  it("sums exactly to the receipt total", () => {
    const r = distributeHaul(10000, [
      { title: "a", quantity: 1, estValueCents: 3333 },
      { title: "b", quantity: 1, estValueCents: 3333 },
      { title: "c", quantity: 1, estValueCents: 3334 },
    ])
    expect(r.reduce((a, b) => a + b.lineTotalCents, 0)).toBe(10000)
  })

  it("splits evenly per unit when no values given", () => {
    const r = distributeHaul(1000, [
      { title: "a", quantity: 3, estValueCents: 0 },
      { title: "b", quantity: 1, estValueCents: 0 },
    ])
    expect(r.map((x) => x.lineTotalCents)).toEqual([750, 250])
    expect(r[0].unitCostCents).toBe(250)
  })

  it("weights by value × qty", () => {
    const r = distributeHaul(900, [
      { title: "a", quantity: 2, estValueCents: 100 },
      { title: "b", quantity: 1, estValueCents: 100 },
    ])
    expect(r.map((x) => x.lineTotalCents)).toEqual([600, 300])
  })
})

describe("misc", () => {
  it("mileage and toCents", () => {
    expect(mileageDeduction(15.5, 76)).toBe(1178)
    expect(toCents("$1,234.56")).toBe(123456)
    expect(toCents("abc")).toBe(0)
    expect(toCents("0.1")).toBe(10)
  })
})

import { expenseTotals, subscriptionCost } from "./overhead"

describe("overhead", () => {
  const now = new Date("2026-09-25T12:00:00")
  it("subscription cost by range", () => {
    const subs = [
      { id: "1", name: "a", amount_cents: 3000, active: true, started_at: "2026-07-10" },
      { id: "2", name: "b", amount_cents: 999, active: false, started_at: "2026-01-01" },
    ]
    expect(subscriptionCost(subs, "all", now)).toBe(9000) // Jul, Aug, Sep
    expect(subscriptionCost(subs, "month", now)).toBe(3000)
    expect(subscriptionCost(subs, "today", now)).toBe(100)
  })
  it("expense totals split mileage", () => {
    const t = expenseTotals(
      [
        { id: "1", kind: "expense", title: "box", category: "Packaging", amount_cents: 472, spent_at: "2026-09-22T12:00:00", miles: null, rate_cents: null },
        { id: "2", kind: "mileage", title: "m", category: "Travel", amount_cents: 347, spent_at: "2026-09-22T12:00:00", miles: 4.6, rate_cents: 76 },
      ],
      "all", now,
    )
    expect(t).toMatchObject({ expenseCents: 472, mileageCents: 347, miles: 4.6, trips: 1, total: 819 })
  })
})

describe("distributeHaul exactness with multi-unit lines", () => {
  it("the Walmart haul: $100 over 5 + 1 units sums to $100.00", () => {
    const r = distributeHaul(10000, [
      { title: "a", quantity: 5, estValueCents: 2000 },
      { title: "b", quantity: 1, estValueCents: 2000 },
    ])
    expect(r.reduce((a, b) => a + b.lineTotalCents, 0)).toBe(10000)
    expect(r[0].lineTotalCents).toBe(r[0].unitCostCents * 5)
  })
})
