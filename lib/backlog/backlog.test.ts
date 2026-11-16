import { describe, expect, it } from "vitest"
import { EXPENSE_FIELDS, guessMapping, ITEM_FIELDS } from "./columns"
import { cellText, parseCsv, sheetCsvUrl, splitHeader } from "./parse"
import { expenseCategory, makeRefs, mapExpenseRow, mapItemRow, platformFrom } from "./rows"
import { parseDate, parseMoney, parsePercent, parseQty } from "./values"

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, commas and newlines in cells, CRLF and a BOM", () => {
    const csv = '﻿Title,Cost\r\n"Nike ""Tech"" Hoodie, M",12.00\r\n"Two\nlines",3\r\n\r\n'
    expect(parseCsv(csv)).toEqual([["Title", "Cost"], ['Nike "Tech" Hoodie, M', "12.00"], ["Two\nlines", "3"]])
  })
  it("sniffs semicolons and tabs", () => {
    expect(parseCsv("a;b\n1,5;2")).toEqual([["a", "b"], ["1,5", "2"]])
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]])
  })
  it("keeps empty cells and a last line without a newline", () => {
    expect(parseCsv("a,,c\n1,,")).toEqual([["a", "", "c"], ["1", "", ""]])
  })
})

describe("splitHeader / cellText", () => {
  it("skips title lines above the headers", () => {
    const t = splitHeader([["My Inventory 2025"], ["Item", "Cost"], ["Hat", "3"], ["", ""]])
    expect(t).toEqual({ headers: ["Item", "Cost"], rows: [["Hat", "3"]] })
  })
  it("names blank headers", () => {
    expect(splitHeader([["Item", "", "Cost"]]).headers).toEqual(["Item", "Column 2", "Cost"])
  })
  it("turns Excel cells into text", () => {
    expect(cellText(new Date(Date.UTC(2025, 2, 4)))).toBe("2025-03-04")
    expect(cellText(12.5)).toBe("12.5")
    expect(cellText(0.1 + 0.2)).toBe("0.3")
    expect(cellText(null)).toBe("")
  })
})

describe("sheetCsvUrl", () => {
  it("builds the CSV export link with the tab", () => {
    const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"
    expect(sheetCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=42`)).toBe(
      `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=42`,
    )
    expect(sheetCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`)).toBe(
      `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`,
    )
  })
  it("refuses other hosts", () => {
    expect(sheetCsvUrl("https://evil.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit")).toBeNull()
    expect(sheetCsvUrl("http://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit")).toBeNull()
  })
})

describe("values", () => {
  it("parses money", () => {
    expect(parseMoney("$1,234.50")).toBe(123450)
    expect(parseMoney("12")).toBe(1200)
    expect(parseMoney("12,5")).toBe(1250)
    expect(parseMoney(" USD 9.99 ")).toBe(999)
    expect(parseMoney(".5")).toBe(50)
    expect(parseMoney("")).toBeNull()
    expect(parseMoney("-")).toBeNull()
    expect(parseMoney("(12.00)")).toBeUndefined()
    expect(parseMoney("-3")).toBeUndefined()
    expect(parseMoney("abc")).toBeUndefined()
  })
  it("parses percents", () => {
    expect(parsePercent("13.25%")).toBeCloseTo(0.1325)
    expect(parsePercent("0.1")).toBe(0.1)
    expect(parsePercent("90%")).toBeUndefined()
  })
  it("parses quantities", () => {
    expect(parseQty("")).toBe(1)
    expect(parseQty("3")).toBe(3)
    expect(parseQty("2.5")).toBeUndefined()
    expect(parseQty("0")).toBeUndefined()
  })
  it("parses dates at noon UTC", () => {
    expect(parseDate("2025-03-04")).toBe("2025-03-04T12:00:00.000Z")
    expect(parseDate("3/4/2025")).toBe("2025-03-04T12:00:00.000Z")
    expect(parseDate("3/4/25")).toBe("2025-03-04T12:00:00.000Z")
    expect(parseDate("25/12/2024")).toBe("2024-12-25T12:00:00.000Z")
    expect(parseDate("Nov 3, 2026")).toBe("2026-11-03T12:00:00.000Z")
    expect(parseDate("3 November 2026")).toBe("2026-11-03T12:00:00.000Z")
    expect(parseDate("45720")).toBe("2025-03-04T12:00:00.000Z") // Excel serial
    expect(parseDate("2025-03-04T15:30:00Z")).toBe("2025-03-04T15:30:00.000Z")
    expect(parseDate("")).toBeNull()
    expect(parseDate("2/30/2025")).toBeUndefined()
    expect(parseDate("yesterday")).toBeUndefined()
  })
})

describe("guessMapping", () => {
  const col = (headers: string[], field: string) => {
    const m = guessMapping(ITEM_FIELDS, headers) as Record<string, number>
    return m[field] >= 0 ? headers[m[field]] : null
  }

  it("reads a FlipLedger export", () => {
    const h = ["number", "title", "status", "quantity", "unit_cost", "total_cost", "cost_missing", "store", "purchased_at", "sold_at", "platform", "unit_sale_price", "buyer_shipping", "revenue", "fees", "label_cost", "net_profit", "return_deadline", "link", "listed_on"]
    const m = guessMapping(ITEM_FIELDS, h)
    const named = Object.fromEntries(Object.entries(m).filter(([, c]) => c >= 0).map(([f, c]) => [f, h[c]]))
    expect(named).toEqual({
      title: "title", status: "status", quantity: "quantity", cost: "unit_cost", totalCost: "total_cost", store: "store",
      purchasedAt: "purchased_at", soldAt: "sold_at", platform: "platform", salePrice: "unit_sale_price",
      buyerShipping: "buyer_shipping", saleTotal: "revenue", fees: "fees", labelCost: "label_cost", link: "link",
    })
  })

  it("reads typical tracker and spreadsheet headers", () => {
    const h = ["Item Name", "SKU", "Purchase Price", "Date Purchased", "Source", "Sold Price", "Date Sold", "Platform", "Shipping Cost", "Fees", "Profit", "Notes"]
    expect(col(h, "title")).toBe("Item Name")
    expect(col(h, "cost")).toBe("Purchase Price")
    expect(col(h, "purchasedAt")).toBe("Date Purchased")
    expect(col(h, "store")).toBe("Source")
    expect(col(h, "salePrice")).toBe("Sold Price")
    expect(col(h, "soldAt")).toBe("Date Sold")
    expect(col(h, "labelCost")).toBe("Shipping Cost")
    expect(col(h, "notes")).toBe("Notes")
    expect(col(h, "listPrice")).toBeNull()
  })

  it("uses a lone Description column as the name", () => {
    expect(col(["Description", "Cost"], "title")).toBe("Description")
    expect(col(["Item", "Description"], "notes")).toBe("Description")
  })

  it("guesses expense columns", () => {
    const h = ["Date", "Vendor", "Category", "Amount", "Miles"]
    const m = guessMapping(EXPENSE_FIELDS, h)
    expect(m).toEqual({ date: 0, title: 1, category: 2, amount: 3, miles: 4 })
  })
})

describe("platformFrom", () => {
  it("maps names and FlipLedger preset labels", () => {
    expect(platformFrom("eBay")).toEqual({ platform: "ebay", soldOn: "ebay" })
    expect(platformFrom("Posh")).toEqual({ platform: "poshmark_amz", soldOn: "poshmark" })
    expect(platformFrom("FB Marketplace")).toEqual({ platform: "facebook", soldOn: "facebook" })
    expect(platformFrom("FB local pickup")).toEqual({ platform: "cash", soldOn: null })
    expect(platformFrom("13.25% eBay Std")).toEqual({ platform: "ebay", soldOn: "ebay" })
    expect(platformFrom("10% Depop/Mercari")).toEqual({ platform: "mercari_depop", soldOn: null })
    expect(platformFrom("Whatnot")).toEqual({ platform: "custom", soldOn: null })
    expect(platformFrom("")).toBeNull()
  })
})

describe("mapItemRow", () => {
  const headers = ["Item", "Qty", "Cost", "Bought", "Sold Date", "Sold Price", "Platform", "Fees", "Shipping", "Status"]
  const m = guessMapping(ITEM_FIELDS, headers)
  const now = new Date("2026-11-16T10:00:00Z")
  const run = (cells: string[], mapping = m) => mapItemRow(cells, mapping, 2, makeRefs(), now)

  it("imports a sale with its real fees and marks it shipped", () => {
    const r = run(["Jordan 4", "1", "$90", "1/2/2025", "2/3/2025", "180", "eBay", "23.85", "14", ""])
    expect(r.ok && r.row).toMatchObject({
      title: "Jordan 4", status: "sold", quantity: 1, cost_cents: 9000, cost_unknown: false,
      purchased_at: "2025-01-02T12:00:00.000Z", sold_at: "2025-02-03T12:00:00.000Z", shipped_at: "2025-02-03T12:00:00.000Z",
      sale_price_cents: 18000, fee_pct: 0, fee_fixed_cents: 2385, label_cost_cents: 1400, platform: "ebay", sold_on: "ebay",
    })
  })

  it("uses the platform's fee rate when there's no fee", () => {
    const r = run(["Hoodie", "", "5", "", "2/3/2025", "40", "Poshmark", "", "", ""])
    expect(r.ok && r.row).toMatchObject({ fee_pct: 0.15, fee_fixed_cents: 0, purchased_at: "2025-02-03T12:00:00.000Z" })
  })

  it("reads a fee rate", () => {
    const r = run(["Hoodie", "", "5", "", "2/3/2025", "40", "", "13%", "", ""])
    expect(r.ok && r.row).toMatchObject({ fee_pct: 0.13, fee_fixed_cents: 0, platform: "cash" })
  })

  it("keeps unsold items in inventory and marks a blank cost unknown", () => {
    const r = run(["Lego set", "2", "", "", "", "", "", "", "", ""])
    expect(r.ok && r.row).toMatchObject({ status: "inventory", quantity: 2, cost_unknown: true, cost_cents: 0, sold_at: null, purchased_at: now.toISOString() })
  })

  it("follows the status column", () => {
    expect(run(["Hat", "", "3", "", "", "", "", "", "", "Returned"])).toMatchObject({ ok: true, row: { status: "returned" } })
    expect(run(["Hat", "", "3", "", "", "", "", "", "", "Active"])).toMatchObject({ ok: true, row: { status: "inventory" } })
    expect(run(["Hat", "", "3", "", "", "", "", "", "", "Sold"])).toEqual({ ok: false, line: 2, reason: "sold, but there's no sold date" })
    expect(run(["Hat", "", "3", "", "", "", "", "", "", "maybe"])).toMatchObject({ ok: false })
  })

  it("splits total cost and total sale across units", () => {
    const h = ["Item", "Qty", "Total Cost", "Revenue", "Sold Date"]
    const r = mapItemRow(["Cards", "4", "20", "100", "2025-05-01"], guessMapping(ITEM_FIELDS, h), 2, makeRefs(), now)
    expect(r.ok && r.row).toMatchObject({ cost_cents: 500, sale_price_cents: 2500, quantity: 4 })
  })

  it("treats a yes/no Sold column as status", () => {
    const h = ["Item", "Sold", "Sold Price"]
    const mm = guessMapping(ITEM_FIELDS, h)
    expect(mapItemRow(["Hat", "No", "12"], mm, 2, makeRefs(), now)).toMatchObject({ ok: true, row: { status: "inventory" } })
  })

  it("sells by price only when the sheet has no sold date or status column", () => {
    const h = ["Item", "Sold For"]
    const mm = guessMapping(ITEM_FIELDS, h)
    expect(mapItemRow(["Hat", "12"], mm, 2, makeRefs(), now)).toEqual({ ok: false, line: 2, reason: "sold, but there's no sold date" })
    expect(mapItemRow(["Hat", ""], mm, 2, makeRefs(), now)).toMatchObject({ ok: true, row: { status: "inventory" } })
  })

  it("explains bad cells", () => {
    expect(run(["", "", "", "", "", "", "", "", "", ""])).toEqual({ ok: false, line: 2, reason: "no item name" })
    expect(run(["Hat", "1.5", "", "", "", "", "", "", "", ""])).toMatchObject({ reason: 'quantity "1.5" isn\'t a whole number' })
    expect(run(["Hat", "", "abc", "", "", "", "", "", "", ""])).toMatchObject({ reason: 'cost "abc" isn\'t an amount' })
    expect(run(["Hat", "", "", "someday", "", "", "", "", "", ""])).toMatchObject({ reason: 'purchase date "someday" isn\'t a date' })
  })

  it("gives identical rows different, repeatable refs", () => {
    const cells = ["Hat", "", "3", "1/1/2025", "", "", "", "", "", ""]
    const once = () => {
      const ref = makeRefs()
      return [mapItemRow(cells, m, 2, ref, now), mapItemRow(cells, m, 3, ref, now)].map((r) => (r.ok ? r.row.import_ref : ""))
    }
    const [a, b] = once()
    expect(a).not.toBe(b)
    expect(once()).toEqual([a, b])
    expect(a).toMatch(/^item:[0-9a-z]+$/)
  })
})

describe("mapExpenseRow", () => {
  const m = guessMapping(EXPENSE_FIELDS, ["Date", "Description", "Category", "Amount", "Miles"])
  const run = (cells: string[]) => mapExpenseRow(cells, m, 5, makeRefs(), 70)

  it("imports an expense with a matched category", () => {
    expect(run(["3/1/2025", "Poly mailers", "", "$24.99", ""])).toMatchObject({
      ok: true, row: { kind: "expense", title: "Poly mailers", category: "Packaging", amount_cents: 2499, spent_at: "2025-03-01T12:00:00.000Z" },
    })
    expect(run(["3/1/2025", "Lunch", "meals", "12", ""])).toMatchObject({ ok: true, row: { category: "Meals" } })
  })

  it("turns miles without an amount into mileage at the seller's rate", () => {
    expect(run(["3/1/2025", "Goodwill run", "", "", "12.5"])).toMatchObject({
      ok: true, row: { kind: "mileage", title: "Mileage: Goodwill run", category: "Travel", miles: 12.5, rate_cents: 70, amount_cents: 875 },
    })
  })

  it("explains bad rows", () => {
    expect(run(["", "Tape", "", "3", ""])).toEqual({ ok: false, line: 5, reason: "no date" })
    expect(run(["3/1/2025", "Tape", "", "", ""])).toEqual({ ok: false, line: 5, reason: "no amount" })
    expect(run(["3/1/2025", "Tape", "", "lots", ""])).toMatchObject({ ok: false })
  })

  it("matches categories loosely", () => {
    expect(expenseCategory("Shipping Supplies")).toBe("Shipping Supplies")
    expect(expenseCategory("", "Vendoo monthly")).toBe("Software")
    expect(expenseCategory("misc")).toBe("Other")
  })
})
