import { PDFDocument } from "pdf-lib"
import { describe, expect, it } from "vitest"
import { buildTaxPdf, pdfText } from "./tax-pdf"
import type { Expense, Item } from "./types"

const sold = (p: Partial<Item>): Item => ({
  id: Math.random().toString(36), seq: 1, title: "Nike “Dunk” Low – size 10…", status: "sold", quantity: 1, cost_cents: 2000,
  cost_unknown: false, purchased_at: "2026-01-01T12:00:00Z", store: null, link_url: null, haul_id: null,
  sale_price_cents: 9000, buyer_shipping_cents: 0, label_cost_cents: 800, fee_pct: 0.1325, fee_fixed_cents: 0,
  sales_tax_cents: 700, refund_cents: 0, platform: "ebay", sold_at: "2026-03-10T12:00:00", returnable: false,
  return_deadline: null, photo_paths: [], photo_urls: [], description: null, condition: null, brand: null, size: null,
  list_price_cents: null, listings: [], created_at: "2026-01-01T12:00:00Z", ...p,
})

const trip = (i: number): Expense => ({
  id: `t${i}`, kind: "mileage", title: "Mileage: Goodwill run", category: "Mileage", amount_cents: 870,
  spent_at: `2026-04-${String((i % 28) + 1).padStart(2, "0")}T12:00:00`, miles: 12.4, rate_cents: 70,
  start_location: "40.71, -74.00", end_location: "Goodwill − Main St", ...{},
})

describe("pdfText", () => {
  it("swaps characters the standard PDF fonts can't draw", () => {
    expect(pdfText("− Sales tax “quoted” ‘x’ … ✓ ok · $5")).toBe("- Sales tax \"quoted\" 'x' ...  ok · $5")
  })
})

describe("buildTaxPdf", () => {
  it("builds a multi-page PDF from a year's data", async () => {
    const bytes = await buildTaxPdf({
      year: 2026,
      email: "seller@example.com",
      items: [sold({}), sold({ platform: "cash", sales_tax_cents: 0 })],
      expenses: Array.from({ length: 80 }, (_, i) => trip(i)),
      subs: [],
      bracket: 0.22,
      forms: { ebay: 10000 },
      cancelled: [],
      now: new Date(2026, 10, 13),
    })
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-")
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3)
    expect(doc.getTitle()).toBe("FlipLedger Tax Report 2026")
  })
})
