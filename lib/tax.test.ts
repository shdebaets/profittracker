import { describe, expect, it } from "vitest"
import {
  estimatedTax, irsQuarters, mileageLog, nextQuarter, periodReport, reconcile, salePlatform, scheduleC,
  taxSavings, yearPeriod, yearReport,
} from "./tax"
import type { Expense, Item, Listing, Subscription } from "./types"

function item(p: Partial<Item>): Item {
  return {
    id: Math.random().toString(36), seq: 1, title: "Thing", status: "sold", quantity: 1, cost_cents: 0,
    cost_unknown: false, purchased_at: "2026-01-01T12:00:00Z", store: null, link_url: null, haul_id: null,
    sale_price_cents: 0, buyer_shipping_cents: 0, label_cost_cents: 0, fee_pct: 0, fee_fixed_cents: 0,
    platform: "ebay", sold_at: "2026-03-10T12:00:00", returnable: false, return_deadline: null, photo_paths: [],
    photo_urls: [], description: null, condition: null, brand: null, size: null, list_price_cents: null,
    listings: [], created_at: "2026-01-01T12:00:00Z", ...p,
  }
}

function expense(p: Partial<Expense>): Expense {
  return {
    id: Math.random().toString(36), kind: "expense", title: "Tape", category: "Packaging", amount_cents: 0,
    spent_at: "2026-02-01T12:00:00", miles: null, rate_cents: null, start_location: null, end_location: null, ...p,
  }
}

const now = new Date(2026, 10, 13) // Nov 13 2026

describe("salePlatform", () => {
  it("prefers the sold cross-listing's marketplace", () => {
    const l = { marketplace: "poshmark", status: "sold" } as Listing
    expect(salePlatform(item({ platform: "ebay", listings: [l] }))).toBe("poshmark")
  })
  it("falls back to the fee preset", () => {
    expect(salePlatform(item({ platform: "mercari_depop" }))).toBe("mercari")
    expect(salePlatform(item({ platform: "cash" }))).toBe("local")
    expect(salePlatform(item({ platform: "card" }))).toBe("other")
  })
})

describe("yearReport", () => {
  const items = [
    // eBay: $40 + $5 shipping, 10% fee, $6 label, $10 cost
    item({ sale_price_cents: 4000, buyer_shipping_cents: 500, fee_pct: 0.1, label_cost_cents: 600, cost_cents: 1000 }),
    item({ platform: "cash", sale_price_cents: 2000, cost_cents: 500 }),
    item({ sale_price_cents: 9999, sold_at: "2025-12-31T12:00:00" }), // other year
    item({ status: "inventory", cost_cents: 7000, sold_at: null }),
  ]
  const expenses = [
    expense({ amount_cents: 1200 }),
    expense({ category: "Meals", amount_cents: 2000 }),
    expense({ kind: "mileage", category: "Travel", miles: 10, rate_cents: 70, amount_cents: 700 }),
  ]
  const subs: Subscription[] = [{ id: "s", name: "Tool", amount_cents: 1000, active: true, started_at: "2026-09-01" }]
  const r = yearReport(items, expenses, subs, 2026, now)

  it("totals sales in the year by platform", () => {
    expect(r.totals.sales).toBe(2)
    expect(r.platforms.map((p) => p.platform)).toEqual(["ebay", "local"])
    const ebay = r.platforms[0]
    expect(ebay.gross).toBe(4500)
    expect(ebay.fees).toBe(450)
    expect(ebay.net).toBe(4500 - 450 - 600 - 1000)
  })

  it("counts mileage, expenses and subscription months", () => {
    expect(r.miles).toBe(10)
    expect(r.mileageCents).toBe(700)
    expect(r.expenseCents).toBe(3200)
    expect(r.subscriptionCents).toBe(3000) // Sep, Oct, Nov
    expect(r.netProfit).toBe(r.totals.net - 700 - 3200 - 3000)
  })

  it("tax savings = write-offs × bracket", () => {
    const t = taxSavings(r, 0.22)
    expect(t.deductions).toBe(700 + 3200 + 3000 + 1500)
    expect(t.savings).toBe(Math.round(t.deductions * 0.22))
  })

  it("maps Schedule C lines and halves meals", () => {
    const lines = scheduleC(r)
    const get = (line: string) => lines.filter((l) => l.line === line).reduce((a, l) => a + l.cents, 0)
    expect(get("1")).toBe(6500)
    expect(get("4")).toBe(1500)
    expect(get("9")).toBe(700)
    expect(get("10")).toBe(450)
    expect(get("22")).toBe(1200)
    expect(get("24b")).toBe(1000)
    expect(get("31")).toBe(6500 - 1500 - (700 + 450 + 1200 + 1000 + 600 + 3000))
  })

  it("reconciles against an entered 1099-K", () => {
    const rows = reconcile(r, { ebay: 4800 })
    expect(rows).toHaveLength(1) // cash sales get no 1099-K
    expect(rows[0]).toMatchObject({ platform: "ebay", reported: 4800, reportedEntered: true, unexplained: 300 })
    const unentered = reconcile(r, {})[0]
    expect(unentered).toMatchObject({ reported: 4500, reportedEntered: false, unexplained: 0 })
  })
})

describe("quarters", () => {
  it("uses the IRS periods and due dates", () => {
    const q = irsQuarters(2026)
    expect(q[1].period.to).toEqual(new Date(2026, 5, 1))
    expect(q[3].due).toEqual(new Date(2027, 0, 15))
  })
  it("finds the next due quarter, including last year's Q4 in early January", () => {
    expect(nextQuarter(now)).toMatchObject({ n: 4, year: 2026 })
    expect(nextQuarter(new Date(2027, 0, 10))).toMatchObject({ n: 4, year: 2026 })
    expect(nextQuarter(new Date(2027, 0, 16))).toMatchObject({ n: 1, year: 2027 })
  })
  it("estimates SE + income tax and ignores losses", () => {
    const e = estimatedTax(100_000, 0.22)
    expect(e.se).toBe(Math.round(100_000 * 0.9235 * 0.153))
    expect(e.income).toBe(Math.round((100_000 - e.se / 2) * 0.22))
    expect(estimatedTax(-5000, 0.22).total).toBe(0)
  })
  it("reports a single period", () => {
    const r = periodReport([item({ sale_price_cents: 1000 })], [], [], irsQuarters(2026)[0].period, now)
    expect(r.totals.gross).toBe(1000)
    expect(periodReport([item({ sale_price_cents: 1000 })], [], [], yearPeriod(2025), now).totals.sales).toBe(0)
  })
})

describe("mileageLog", () => {
  it("lists the year's trips in date order with locations", () => {
    const log = mileageLog(
      [
        expense({ kind: "mileage", title: "Mileage: Thrift Store Sourcing", spent_at: "2026-05-02T12:00:00", miles: 12.4, rate_cents: 70, amount_cents: 868, start_location: "Home", end_location: "Goodwill" }),
        expense({ kind: "mileage", title: "Mileage: Supply Run", spent_at: "2026-01-02T12:00:00", miles: 3, rate_cents: 70, amount_cents: 210 }),
        expense({ amount_cents: 500 }),
      ],
      2026,
    )
    expect(log).toHaveLength(2)
    expect(log[0]["Business purpose"]).toBe("Supply Run")
    expect(log[1]).toMatchObject({ "Start location": "Home", "End location": "Goodwill", Miles: "12.4", Deduction: "8.68" })
  })
})
