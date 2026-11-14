import { describe, expect, it } from "vitest"
import { buyProfit, compStats, isGtin, isNewCondition, median, queryKey } from "./stats"

const now = new Date("2026-11-13T12:00:00Z")
const sold = (days: number, priceCents: number, bestOffer = false) => ({
  priceCents, shippingCents: 0, bestOffer, soldOn: new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10),
})

describe("comps", () => {
  it("normalises queries and spots barcodes", () => {
    expect(queryKey("  Nintendo  Switch-OLED! ")).toBe("nintendo switch oled")
    expect(isGtin("045496883386")).toBe(true)
    expect(isGtin("switch")).toBe(false)
  })
  it("medians", () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(3)
    expect(median([])).toBeNull()
  })
  it("prefers 30-day sold, skips best offers, computes sell-through", () => {
    const s = compStats(
      [{ priceCents: 4000, shippingCents: 500, title: "", condition: null, buyItNow: true }],
      [sold(2, 3000), sold(10, 3400), sold(20, 9999, true), sold(60, 1000)],
      now,
    )
    expect(s).toMatchObject({ sold30: 3, sold90: 4, soldMedian30: 3200, estimate: 3200, estimateSource: "sold30", activeLowest: 4500 })
    expect(s.sellThrough).toBeCloseTo(3 / 4)
    expect(s.daysOfSupply).toBe(10)
  })
  it("falls back to live listings", () => {
    const s = compStats([{ priceCents: 2000, shippingCents: null, title: "", condition: null, buyItNow: true }], [], now)
    expect(s).toMatchObject({ estimate: 2000, estimateSource: "active", sellThrough: 0 })
  })
  it("counts every live match, not just the page read", () => {
    const one = { priceCents: 2000, shippingCents: null, title: "", condition: null, buyItNow: true }
    const s = compStats([one], [sold(2, 3000), sold(5, 3000), sold(9, 3000)], now, 30)
    expect(s.activeCount).toBe(30)
    expect(s.sellThrough).toBeCloseTo(3 / 33)
    expect(s.daysOfSupply).toBe(300)
  })
  it("splits new from used once there are 3+ of each", () => {
    const live = (cents: number, condition: string) => ({ priceCents: cents, shippingCents: 0, title: "", condition, buyItNow: true })
    const s = compStats(
      [live(10000, "New"), live(11000, "New"), live(12000, "New"), live(7000, "Used"), live(8000, "Open box"), live(9000, "Pre-owned")],
      [],
      now,
    )
    expect(s.newEstimate).toBe(11000)
    expect(s.usedEstimate).toBe(8000)
    expect(compStats([live(10000, "New")], [], now).newEstimate).toBeNull()
  })
  it("reads eBay's condition names", () => {
    for (const c of ["New", "Brand New", "New/Factory Sealed", "New with tags", "NEW"]) expect(isNewCondition(c)).toBe(true)
    for (const c of ["New other (see details)", "Open box", "Used", "Pre-owned", "Seller refurbished", null]) expect(isNewCondition(c)).toBe(false)
  })
  it("profit after eBay fee and label", () => {
    const p = buyProfit(800, 3200)
    expect(p.fees).toBe(Math.round(3200 * 0.1325))
    expect(p.profit).toBe(3200 - p.fees - 600 - 800)
  })

  it("uses the newest sales for a fast seller and works the 30-day count out from the pace", () => {
    // The 30th Celebration UPC Night on 14 Nov 2026: launch-week sales ~$540+, this week ~$350-$400.
    const today = new Date("2026-11-14T12:00:00Z")
    const s = (day: string, dollars: number) => ({ priceCents: dollars * 100, shippingCents: 0, soldOn: day, bestOffer: false, condition: "New" })
    const thisWeek = [352.9, 347.67, 358.19, 443.27, 402.91, 380, 348.35, 407.08, 386.36, 379.99, 372.89, 399.99, 384.19, 349.99, 379.95, 398.36, 567.81, 375, 647.43, 544.83]
    const sales = [...thisWeek.map((p) => s("2026-11-13", p)), ...Array.from({ length: 40 }, () => s("2026-11-12", 540))]
    const st = compStats([], sales, today)
    expect(st.estimateSource).toBe("recent")
    // $647.43 (over 1.5x) is dropped; the median of the rest:
    expect(st.estimate).toBe(38000)
    expect(st.sold30Estimated).toBe(true)
    expect(st.sold30).toBe(900) // 60 sales over 2 days → ~30/day
  })
})
