import { describe, expect, it } from "vitest"
import { maxCost, profitAt, verdict, DEFAULT_RESEARCH_FEES } from "./calc"
import { windowET } from "./days"
import {
  chartDays, dayTicks, headlineMetrics, isLive, reconciledSales, soldMedian, specificsVerdict, spreadUnits, usablePrice,
} from "./metrics"
import { editionRule, matchExclusion, type Profile } from "./profile"
import { detailsTodo, ruleVerdict } from "./pipeline"
import type { Listing, Sale } from "./types"

const NOW = new Date("2026-11-10T17:00:00Z")

const night: Profile = {
  canonical_name: "30th Celebration Ultra-Premium Collection Night",
  release_date: "2026-11-06",
  versions: [{ key: "night", name: "Night", aliases: ["Umbreon"], abbreviations: [], color_hints: [], price_low: 350, price_high: 500 }],
  other_editions: [{ name: "Day", words: ["Espeon"] }],
  keywords: ["30th celebration upc night"],
  exclusions: [{ label: "Graded", words: ["psa", "cgc"] }],
}

const sale = (p: Partial<Sale>): Sale => ({
  id: 1, product_id: "p", external_id: "100000001", listing_id: null, source: "collector", version_key: "night", verdict: "night",
  reason: null, judge_attempts: 0, human_decision: false, sold_on: "2026-11-08", title: "t", url: null, price: 400, shipping: 0,
  best_offer: false, presale: false, format: null, condition: null, seller: null, variants_matched: [], qty: 1, units: 1,
  volume_days: [], listing_created_at: null, specifics: null, details_state: "available", collected_at: null, ...p,
})

const listing = (p: Partial<Listing>): Listing => ({
  id: "l1", product_id: "p", item_id: "v1|200000001|0", legacy_id: "200000001", title: "Night box", price: 380, shipping: 0,
  currency: "USD", condition: null, category: null, seller: null, seller_feedback: null, buying_options: ["FIXED_PRICE"], image_url: null,
  url: null, matched_keywords: [], status: "counted", version_key: "night", reason: null, confidence: null, judged_by: "ai",
  judge_attempts: 0, presale: false, best_offer: false, start_date: "2026-11-01T00:00:00Z", end_date: null, sold_qty: 0, avail_qty: 1,
  specifics: null, details_state: "available", details_fetched_at: null, live: true, first_seen: "2026-11-09", last_seen: "2026-11-10",
  search_run_id: null, ...p,
})

describe("profile rules", () => {
  it("rejects the other edition, multi-edition lots and needs specifics when neither is named", () => {
    expect(editionRule("Pokemon 30th UPC Day Espeon sealed", night)).toEqual({ verdict: "reject", reason: "other version: Day" })
    expect(editionRule("UPC Night AND Day bundle", night)?.reason).toBe("multiple editions")
    expect(editionRule("Pokemon 30th Celebration UPC sealed", night)?.verdict).toBe("unknown_version")
    expect(editionRule("UPC Night Umbreon sealed", night)).toBeNull()
  })
  it("matches exclusion words and the price band", () => {
    expect(matchExclusion("PSA 10 promo", night)?.label).toBe("Graded")
    expect(ruleVerdict("UPC Night", 50, night).status).toBe("rejected")
    expect(ruleVerdict("UPC Night", 420, night).status).toBe("pending")
  })
})

describe("item specifics cross-check", () => {
  it("treats a list naming several cards as neutral and 'Not shown' language as unknown", () => {
    expect(specificsVerdict({ Character: "Espeon, Jigglypuff, Mew, Umbreon", Language: "Not shown" }, "night", night)).toBeNull()
  })
  it("sends other languages and multi-box quantities to review", () => {
    expect(specificsVerdict({ Language: "Japanese" }, "night", night)?.verdict).toBe("review")
    expect(specificsVerdict({ "Number of Boxes": "2" }, "night", night)?.verdict).toBe("review")
  })
  it("assigns the version from a field that names only it", () => {
    expect(specificsVerdict({ Character: "Umbreon" }, "unknown_version", night)).toEqual({ verdict: "night", reason: "Version assigned from item specifics" })
  })
})

describe("sold math", () => {
  it("excludes best offers and post-release presales from prices", () => {
    expect(usablePrice(sale({ best_offer: true }), "2026-11-06")).toBe(false)
    expect(usablePrice(sale({ presale: true, sold_on: "2026-11-08" }), "2026-11-06")).toBe(false)
    expect(usablePrice(sale({ presale: true, sold_on: "2026-11-01" }), "2026-11-06")).toBe(true)
    expect(usablePrice(sale({ price: null }), null)).toBe(false)
  })
  it("uses full ET days ending yesterday (a sale at 11pm ET counts on its ET day)", () => {
    expect(windowET(7, NOW)).toEqual({ from: "2026-11-03", to: "2026-11-10" })
    const sales = [sale({ id: 1, sold_on: "2026-11-09", price: 400 }), sale({ id: 2, sold_on: "2026-11-10", price: 999 })]
    expect(soldMedian(sales, 7, null, NOW)).toBe(400)
  })
  it("spreads extra units from the release date, not a pre-order listing's creation", () => {
    const r = spreadUnits(10, "2025-11-12T00:00:00Z", "2026-11-09", "2026-11-06")
    expect(r.units).toBe(10)
    expect(r.days[0]!.day).toBe("2026-11-06")
    expect(r.days.reduce((n, d) => n + d.qty, 0)).toBe(10)
  })
  it("counts a listing once, keeping the larger sold estimate", () => {
    const s = sale({ external_id: "200000001", units: 3, qty: 3, volume_days: [{ day: "2026-11-08", qty: 3 }] })
    const l = listing({ sold_qty: 5 })
    const out = reconciledSales([s], [l], NOW, "2026-11-06")
    expect(out).toHaveLength(1)
    expect(out[0]!.units).toBe(5)
  })
})

describe("headline numbers", () => {
  it("ignores ended listings and unconfirmed versions for the lowest Buy It Now", () => {
    const listings = [
      listing({ id: "a", price: 375, end_date: "2026-11-09T00:00:00Z" }),
      listing({ id: "b", price: 350, version_key: "unknown_version", item_id: "b", legacy_id: "b" }),
      listing({ id: "c", price: 380, item_id: "c", legacy_id: "c" }),
      listing({ id: "d", price: 390, avail_qty: 0, item_id: "d", legacy_id: "d" }),
    ]
    expect(isLive(listings[0]!, NOW)).toBe(false)
    const h = headlineMetrics(listings, [], null, NOW)
    expect(h.live).toBe(2)
    expect(h.unconfirmed).toBe(1)
    expect(h.lowestBin).toBe(380)
  })
})

describe("charts", () => {
  it("gives at most 8 distinct whole-day ticks including both ends", () => {
    const days = Array.from({ length: 90 }, (_, i) => `d${i}`)
    const t = dayTicks(days, 8)
    expect(t.length).toBeLessThanOrEqual(8)
    expect(t[0]).toBe("d0")
    expect(t.at(-1)).toBe("d89")
    expect(new Set(t).size).toBe(t.length)
  })
  it("rolls a 7-day median and counts ended-unsold listings in past supply", () => {
    const sales = [sale({ id: 1, sold_on: "2026-11-05", price: 400 }), sale({ id: 2, sold_on: "2026-11-08", price: 420 })]
    const listings = [listing({ id: "x", live: false, start_date: "2026-11-01T12:00:00Z", end_date: "2026-11-04T12:00:00Z", item_id: "x", legacy_id: "x" })]
    const days = chartDays(listings, sales, "2026-11-01", null, NOW)
    expect(days.find((d) => d.day === "2026-11-02")!.live).toBe(1)
    expect(days.find((d) => d.day === "2026-11-06")!.live).toBe(0)
    expect(days.find((d) => d.day === "2026-11-08")!.median7).toBe(410)
  })
})

describe("listing details refresh policy", () => {
  const rows = [
    { id: "new", details_state: "pending" as const, details_fetched_at: null, price: 400, shipping: 0 },
    { id: "fresh", details_state: "available" as const, details_fetched_at: "2026-11-09T12:00:00Z", price: 400, shipping: 0 },
    { id: "old", details_state: "available" as const, details_fetched_at: "2026-11-01T12:00:00Z", price: 400, shipping: 0 },
    { id: "gone", details_state: "unavailable" as const, details_fetched_at: "2026-10-01T12:00:00Z", price: 400, shipping: 0 },
  ]
  it("fetches new or repriced listings, then a 3-day rotation, never unavailable ones", () => {
    expect(detailsTodo(rows, 0, NOW).map((r) => r.id)).toEqual(["new", "old"])
  })
  it("caps the rotation at 150 per product per day", () => {
    expect(detailsTodo(rows, 150, NOW).map((r) => r.id)).toEqual(["new"])
  })
})

describe("profit", () => {
  it("computes the verdict and max cost", () => {
    const p = profitAt(400, 0, 270, DEFAULT_RESEARCH_FEES)
    expect(p.profit).toBeCloseTo(400 - 400 * 1.07 * 0.1325 - 0.4 - 15 - 270, 6)
    expect(verdict(p.roi)).toBe("THIN") // ~21% ROI against a 30% target
    expect(verdict(profitAt(400, 0, 250, DEFAULT_RESEARCH_FEES).roi)).toBe("BUY")
    expect(verdict(null)).toBeNull()
    expect(maxCost(400, 0, DEFAULT_RESEARCH_FEES)).toBeCloseTo(profitAt(400, 0, 0, DEFAULT_RESEARCH_FEES).profit / 1.3, 6)
  })
})
