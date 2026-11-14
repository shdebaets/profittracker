import { describe, expect, it } from "vitest"
import { lastTwoWeeks, quietWeek, weekNumbers } from "./recap"
import type { Expense, Item } from "./types"

const base = {
  seq: 1, status: "sold", quantity: 1, cost_cents: 1000, cost_unknown: false, purchased_at: "2026-11-01T12:00:00Z",
  store: null, link_url: null, haul_id: null, buyer_shipping_cents: 0, label_cost_cents: 0, fee_pct: 0, fee_fixed_cents: 0,
  returnable: false, return_deadline: null, photo_paths: [], photo_urls: [], description: null, condition: null,
  brand: null, size: null, list_price_cents: null, listings: [], created_at: "2026-11-01T12:00:00Z",
}
const item = (p: Partial<Item>) => ({ ...base, id: Math.random().toString(), title: "Jacket", sale_price_cents: 5000, platform: "ebay", sold_at: "2026-11-12T12:00:00Z", ...p }) as Item

describe("weekly recap", () => {
  const { week, prev } = lastTwoWeeks(new Date("2026-11-15T14:00:00Z"))
  const items = [
    item({}),
    item({ title: "Boots", sale_price_cents: 9000, platform: "mercari_depop" }),
    item({ sold_at: "2026-11-05T12:00:00Z" }), // last week
  ]
  const trips = [{ kind: "mileage", spent_at: "2026-11-10T12:00:00Z", miles: 12.4, amount_cents: 868 }] as Expense[]

  it("adds up this week only", () => {
    const n = weekNumbers(items, trips, week)
    expect(n).toMatchObject({ profit: 4000 + 8000, itemsSold: 2, miles: 12.4, mileageWriteOff: 868 })
    expect(n.topItem).toEqual({ title: "Boots", profit: 8000 })
    expect(n.bestPlatform).toEqual({ label: "Mercari", profit: 8000 })
    expect(weekNumbers(items, trips, prev).profit).toBe(4000)
  })
  it("skips quiet weeks", () => {
    const none = weekNumbers([], [], week)
    expect(quietWeek(none, none)).toBe(true)
    expect(quietWeek(weekNumbers(items, [], week), none)).toBe(false)
  })
})
