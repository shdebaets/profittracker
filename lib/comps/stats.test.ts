import { describe, expect, it } from "vitest"
import { buyProfit, compStats, landed, soldPace, isGtin, isNewCondition, median, queryKey, reconcileUnits, spreadUnits, unitsIn } from "./stats"

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
    // $544.83, $567.81 and $647.43 (over 1.3x) are dropped; the median of the rest:
    expect(st.estimate).toBe(37999)
    expect(st.sold30Estimated).toBe(true)
    expect(st.sold30).toBe(900) // 60 sales over 2 days → ~30/day
  })
})

describe("landed price", () => {
  it("adds normal shipping and leaves out sales shipped from overseas", () => {
    expect(landed({ priceCents: 36000, shippingCents: 800 })).toBe(36800)
    expect(landed({ priceCents: 46412, shippingCents: 18229 })).toBeNull()
    expect(landed({ priceCents: 49377, shippingCents: 4856 })).toBeNull()
    expect(landed({ priceCents: 33999, shippingCents: null })).toBe(33999)
  })

  it("keeps overseas sales out of the price but in the count", () => {
    const now = new Date("2026-11-14T20:00:00Z")
    const us = Array.from({ length: 10 }, () => ({ priceCents: 37000, shippingCents: 0, soldOn: "2026-11-14", bestOffer: false }))
    const abroad = Array.from({ length: 6 }, () => ({ priceCents: 48000, shippingCents: 6000, soldOn: "2026-11-14", bestOffer: false }))
    const st = compStats([], [...us, ...abroad], now)
    expect(st.estimate).toBe(37000)
    expect(st.sold30).toBe(16)
  })
})

describe("sold pace", () => {
  const now = new Date("2026-11-14T08:00:00Z")
  it("counts today's sales even before noon UTC and ignores one stray old sale", () => {
    const sold = [...Array.from({ length: 40 }, (_, i) => ({ soldOn: i < 20 ? "2026-11-14" : "2026-11-13" })), { soldOn: "2026-10-01" }]
    // 90% of the sales are within a day: 40 a day → 1,200 a month. The October sale doesn't stretch it.
    expect(soldPace(sold, now)).toBe(1200)
  })
  it("is null when the read reaches back far enough", () => {
    const sold = Array.from({ length: 30 }, (_, i) => ({ soldOn: new Date(now.getTime() - i * 2 * 86_400_000).toISOString().slice(0, 10) }))
    expect(soldPace(sold, now)).toBeNull()
  })
})

describe("30-day count with eBay's total", () => {
  const now = new Date("2026-11-14T20:00:00Z")
  const sale = (d: string) => ({ priceCents: 11000, shippingCents: 0, soldOn: d, bestOffer: false })
  it("doesn't project when the read already has every sale eBay lists", () => {
    const latest = [...Array.from({ length: 60 }, () => sale("2026-11-13")), ...Array.from({ length: 40 }, () => sale("2026-11-10"))]
    const st = compStats([], latest, now, undefined, { latest, total: 100 })
    expect(st.sold30Estimated).toBe(false)
    expect(st.sold30).toBe(100)
  })
  it("caps a projection at eBay's total", () => {
    const latest = Array.from({ length: 240 }, () => sale("2026-11-14"))
    const st = compStats([], latest, now, undefined, { latest, total: 894 })
    expect(st.sold30).toBe(894)
  })
})

describe("30-day count from eBay's own results", () => {
  const now = new Date("2026-11-14T20:00:00Z")
  const sale = (d: string, overseas = false) => ({ priceCents: 36000, shippingCents: 0, soldOn: d, bestOffer: false, overseas })
  it("uses eBay's 30-day count when the read found it", () => {
    const latest = Array.from({ length: 240 }, () => sale("2026-11-14"))
    const st = compStats([], latest, now, undefined, { latest, total: 1117, within30: 994 })
    expect(st.sold30).toBe(994)
    expect(st.sold30Estimated).toBe(false)
  })
  it("leaves overseas sellers out of the price", () => {
    const st = compStats([], [...Array.from({ length: 10 }, () => sale("2026-11-14")), ...Array.from({ length: 9 }, () => ({ ...sale("2026-11-14", true), priceCents: 48000 }))], now)
    expect(st.estimate).toBe(36000)
  })
})

describe("units, not listings", () => {
  const now = new Date("2026-11-14T20:00:00Z") // 3pm in New York
  const today = "2026-11-14"
  it("spreads a multi-unit listing from the day it was listed to its last sale", () => {
    const days = spreadUnits(5, "2026-11-11", "2026-11-14")
    expect(days.reduce((s, d) => s + d.qty, 0)).toBe(5)
    expect(days.filter((d) => d.day === "2026-11-14").reduce((s, d) => s + d.qty, 0)).toBe(2)
    expect(spreadUnits(1, "2026-10-01", today)).toEqual([{ day: today, qty: 1 }])
    // No creation date: every unit on the sale day.
    expect(spreadUnits(3, null, today).reduce((s, d) => s + d.qty, 0)).toBe(3)
  })
  it("counts each listing once at its units, auctions as one, and live listings' unseen sales", () => {
    const sold = [
      { priceCents: 100, shippingCents: 0, soldOn: "2026-11-13", bestOffer: false, itemId: "1", units: 10, createdOn: "2026-11-13" },
      { priceCents: 100, shippingCents: 0, soldOn: "2026-11-12", bestOffer: false, itemId: "1", units: 10, createdOn: "2026-11-13" },
      { priceCents: 100, shippingCents: 0, soldOn: "2026-11-12", bestOffer: false, itemId: "2", units: 4, auction: true },
      { priceCents: 100, shippingCents: 0, soldOn: "2026-11-12", bestOffer: false, itemId: "3" },
    ]
    const live = [
      { priceCents: 100, shippingCents: 0, title: "x", condition: null, buyItNow: true, itemId: "3", soldQty: 6, createdOn: "2026-11-10" },
      { priceCents: 100, shippingCents: 0, title: "y", condition: null, buyItNow: true, itemId: "4", soldQty: 2, createdOn: "2026-11-14" },
      { priceCents: 100, shippingCents: 0, title: "z", condition: null, buyItNow: true, itemId: "5", soldQty: 0 },
    ]
    const days = reconcileUnits(sold, live, today)
    // 10 (item 1, once) + 1 (auction) + 6 (item 3: live count beats the one sale seen) + 2 (item 4).
    expect(unitsIn(days, today, 30)).toBe(19)
    expect(unitsIn(days, "2026-12-31", 7)).toBe(0)
  })
  it("reports units in the 7 and 30 day counts", () => {
    const sold = [
      ...Array.from({ length: 6 }, (_, i) => ({ priceCents: 4000, shippingCents: 0, soldOn: "2026-11-13", bestOffer: false, itemId: `s${i}` })),
      { priceCents: 4000, shippingCents: 0, soldOn: "2026-11-13", bestOffer: false, itemId: "multi", units: 8, createdOn: "2026-11-13" },
      { priceCents: 4000, shippingCents: 0, soldOn: "2026-10-25", bestOffer: false, itemId: "old" },
    ]
    const st = compStats([], sold, now)
    expect(st.sold7).toBe(14)
    expect(st.sold30).toBe(15)
    expect(st.soldListings30).toBe(8)
    expect(st.multiUnitListings).toBe(1)
  })
  it("keeps far-off prices and pre-sales out of the median, but counts them", () => {
    const sold = [
      ...Array.from({ length: 6 }, (_, i) => ({ priceCents: 6000, shippingCents: 0, soldOn: "2026-11-10", bestOffer: false, itemId: `a${i}`, title: "Merry camo set" })),
      { priceCents: 1500, shippingCents: 0, soldOn: "2026-11-10", bestOffer: false, itemId: "cheap", title: "Merry camo pants only" },
      { priceCents: 20000, shippingCents: 0, soldOn: "2026-11-10", bestOffer: false, itemId: "presale", title: "PRE-ORDER Merry camo set" },
      { priceCents: 13000, shippingCents: 0, soldOn: "2026-11-10", bestOffer: false, itemId: "high", title: "Merry camo set" },
    ]
    const st = compStats([], sold, now)
    expect(st.soldMedian30).toBe(6000)
    expect(st.sold30).toBe(9)
  })
})

describe("item price, not shipping", () => {
  const now = new Date("2026-11-14T20:00:00Z")
  it("prices sales by item price (shipping varies by viewer) but lowest live includes shipping", () => {
    const sold = [9000, 9400, 9700, 9800, 11800].map((p, i) => ({ priceCents: p, shippingCents: [2103, 750, 982, 0, 1195][i], soldOn: "2026-11-13", bestOffer: false, itemId: `g${i}` }))
    const live = [
      { priceCents: 9999, shippingCents: 1500, title: "a", condition: null, buyItNow: true },
      { priceCents: 10500, shippingCents: 0, title: "b", condition: null, buyItNow: true },
    ]
    const st = compStats(live, sold, now)
    expect(st.soldMedian30).toBe(9700)
    expect(st.activeLowest).toBe(10500)
    // Overseas sellers (shipping over $25) still stay out.
    expect(compStats([], [...sold, { priceCents: 50000, shippingCents: 6000, soldOn: "2026-11-13", bestOffer: false }], now).soldMedian30).toBe(9700)
  })
})
