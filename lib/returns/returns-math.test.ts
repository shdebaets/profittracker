import { describe, expect, it } from "vitest"
import { calcSale, itemSale, returnLoss, storeRefundCents, summarize } from "@/lib/profit"
import { periodReport, RETURN_LOSSES, scheduleC, yearPeriod, type YearReport } from "@/lib/tax"
import type { Item } from "@/lib/types"

const base: Item = {
  id: "x", seq: 1, title: "t", status: "returned", quantity: 1, cost_cents: 2000, cost_unknown: false,
  purchased_at: "2026-09-01T12:00:00Z", store: "Target", link_url: null, haul_id: null,
  sale_price_cents: null, buyer_shipping_cents: 0, label_cost_cents: 0, fee_pct: 0,
  fee_fixed_cents: 0, sales_tax_cents: 0, refund_cents: 0, platform: null, sold_at: null,
  returnable: true, return_deadline: null, photo_paths: [], photo_urls: [],
  description: null, condition: null, brand: null, size: null, list_price_cents: null, category: null, sold_on: null, shipped_at: null, listings: [],
  created_at: "2026-09-01T12:00:00Z",
  returned_at: "2026-11-10T12:00:00Z",
}
const it_ = (p: Partial<Item>): Item => ({ ...base, ...p })
const now = new Date("2026-11-20T12:00:00Z")

describe("store returns", () => {
  it("counts a missing refund as a full refund, so old returned rows lose nothing", () => {
    expect(storeRefundCents(it_({ quantity: 2 }))).toBe(4000)
    expect(returnLoss(it_({}))).toBe(0)
  })

  it("loses what the store kept plus what the return cost", () => {
    expect(returnLoss(it_({ quantity: 2, store_refund_cents: 3500, return_cost_cents: 300 }))).toBe(500 + 300)
    // A refund above cost isn't a gain on the books.
    expect(returnLoss(it_({ store_refund_cents: 2500 }))).toBe(0)
    expect(returnLoss(it_({ status: "inventory", store_refund_cents: 0 }))).toBe(0)
  })

  it("takes the loss off dashboard net in the range it was returned", () => {
    const sold = it_({ status: "sold", sale_price_cents: 5000, sold_at: "2026-11-12T12:00:00Z", cost_cents: 1000 })
    const back = it_({ store_refund_cents: 1500, return_cost_cents: 200 })
    const s = summarize([sold, back], "all", now)
    expect(s.returnLosses).toBe(700)
    expect(s.net).toBe(4000 - 700)
    expect(s.avgProfit).toBe(4000) // per-sale average isn't dragged down by returns
    expect(summarize([back], "week", now).returnLosses).toBe(0) // returned Nov 10, outside this week
  })

  it("adds the loss to tax expenses on Schedule C line 27a", () => {
    const r = periodReport([it_({ store_refund_cents: 1500, return_cost_cents: 200 })], [], [], yearPeriod(2026), now)
    expect(r.expensesByCategory[RETURN_LOSSES]).toBe(700)
    expect(r.expenseCents).toBe(700)
    expect(r.netProfit).toBe(-700)
    const lines = scheduleC({ year: 2026, ...r } as YearReport)
    expect(lines).toContainEqual({ line: "27a", label: "Other expenses (restocking fees, return costs)", cents: 700 })
  })
})

describe("buyer returns", () => {
  const sale = it_({
    status: "sold", sale_price_cents: 5000, buyer_shipping_cents: 500, label_cost_cents: 600, fee_pct: 0.1325,
    sold_at: "2026-11-12T12:00:00Z", cost_cents: 2000,
  })

  it("leaves an ordinary sale unchanged", () => {
    expect(itemSale(sale)).toEqual(calcSale({ costCents: 2000, salePriceCents: 5000, quantity: 1, buyerShippingCents: 500, labelCostCents: 600, feePct: 0.1325 }))
  })

  it("a full refund with restock nets out to the fees kept and both labels", () => {
    const back = itemSale({ ...sale, buyer_returned_at: "2026-11-15T00:00:00Z", refund_cents: 5500, restocked: true, return_label_cents: 700, fee_credit_cents: 600 })
    // fees: round(5500 × 0.1325) = 729, minus 600 back = 129
    expect(back).toMatchObject({ revenue: 5500, fees: 129, cog: 0, shipping: 1300 })
    expect(back.net).toBe(5500 - 129 - 1300 - 0 - 5500)
  })

  it("keeps the cost as a loss when the item didn't come back to stock", () => {
    expect(itemSale({ ...sale, refund_cents: 5500, restocked: false }).cog).toBe(2000)
  })

  it("puts the refund on line 2 and leaves the restocked cost out of COGS", () => {
    const r = periodReport([{ ...sale, buyer_returned_at: "2026-11-15T00:00:00Z", refund_cents: 5500, restocked: true }], [], [], yearPeriod(2026), now)
    expect(r.totals.refunds).toBe(5500)
    expect(r.totals.cogs).toBe(0)
    expect(r.totals.gross).toBe(5500)
  })
})
