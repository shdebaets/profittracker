import { describe, expect, it } from "vitest"
import { lotStats, type Haul } from "./lots"
import { askingPrice, daysSitting, repriced, staleItems } from "./stale"
import type { Item, Listing } from "./types"

function item(p: Partial<Item>): Item {
  return {
    id: Math.random().toString(36), seq: 1, title: "Game", status: "inventory", quantity: 1, cost_cents: 400,
    cost_unknown: false, purchased_at: "2026-08-01T12:00:00Z", store: null, link_url: null, haul_id: "h1",
    sale_price_cents: null, buyer_shipping_cents: 0, label_cost_cents: 0, fee_pct: 0, fee_fixed_cents: 0,
    platform: null, sold_at: null, returnable: false, return_deadline: null, photo_paths: [], photo_urls: [],
    description: null, condition: null, brand: null, size: null, list_price_cents: null, listings: [],
    created_at: "2026-08-01T12:00:00Z", ...p,
  }
}
const haul: Haul = { id: "h1", title: "50 games", store: null, total_cents: 20000, purchased_at: "2026-08-01", receipt_path: null, split_mode: "even" }

describe("lotStats", () => {
  it("adds up what a lot returned after fees and labels", () => {
    const items = [
      item({ quantity: 40 }),
      item({ status: "sold", quantity: 10, sale_price_cents: 7000, fee_pct: 0.1, label_cost_cents: 500 }),
      item({ haul_id: "other", status: "sold", quantity: 1, sale_price_cents: 99999 }),
    ]
    const s = lotStats(haul, items)
    expect(s).toMatchObject({ units: 50, unitsSold: 10, unitsLeft: 40, stockCost: 16000 })
    expect(s.returned).toBe(70000 - 7000 - 500)
    expect(s.profit).toBe(62500 - 20000)
    expect(s.roi).toBeCloseTo(42500 / 20000)
  })
})

describe("stale", () => {
  const now = new Date("2026-11-13T12:00:00Z")
  it("counts days from the first live listing, else purchase", () => {
    const l = { status: "active", listed_at: "2026-10-14T12:00:00Z" } as Listing
    expect(daysSitting(item({ listings: [l] }), now)).toBe(30)
    expect(daysSitting(item({}), now)).toBe(104)
  })
  it("only flags unsold items past the threshold", () => {
    const fresh = item({ purchased_at: "2026-11-01T12:00:00Z" })
    const old = item({})
    const sold = item({ status: "sold" })
    expect(staleItems([fresh, old, sold], 60, now)).toEqual([old])
  })
  it("reprices by percent, amount or exact, never below 99 cents", () => {
    expect(repriced(4000, { mode: "percent", value: 15 })).toBe(3400)
    expect(repriced(4000, { mode: "amount", value: 500 })).toBe(3500)
    expect(repriced(4000, { mode: "set", value: 2999 })).toBe(2999)
    expect(repriced(500, { mode: "amount", value: 1000 })).toBe(99)
  })
  it("uses list price, else the highest live listing", () => {
    expect(askingPrice(item({ list_price_cents: 2500 }))).toBe(2500)
    const ls = [{ status: "active", price_cents: 1800 }, { status: "active", price_cents: 2200 }, { status: "sold", price_cents: 9000 }] as Listing[]
    expect(askingPrice(item({ listings: ls }))).toBe(2200)
    expect(askingPrice(item({}))).toBeNull()
  })
})
