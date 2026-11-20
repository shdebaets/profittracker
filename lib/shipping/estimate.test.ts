import { describe, expect, it } from "vitest"
import { cheapestTypical, dimWeightLb, estimateShipping } from "./estimate"

const shoe = { lengthIn: 14, widthIn: 10, heightIn: 5 } // 700 cu in, under 1 cu ft
const poly = { lengthIn: 10, widthIn: 13, heightIn: 2 }

describe("estimateShipping", () => {
  it("prices a 2 lb shoe box from the published table (zones 1, 5, 8)", () => {
    const e = estimateShipping(32, shoe)
    if (!e.ok) throw new Error("expected a price")
    expect(e.services).toEqual([
      { service: "Ground Advantage", nearby: 839, typical: 1050, far: 1342, dimWeightLb: null },
      { service: "Priority Mail", nearby: 950, typical: 1402, far: 1722, dimWeightLb: null },
    ])
  })

  it("rounds weight up to the next row", () => {
    const e = estimateShipping(17, poly) // just over 1 lb → 2 lb row
    if (!e.ok) throw new Error()
    expect(e.services[0].nearby).toBe(839)
    const light = estimateShipping(5, poly) // 5 oz → 8 oz row
    if (!light.ok) throw new Error()
    expect(light.services[0]).toMatchObject({ nearby: 733, typical: 824, far: 895 })
    expect(light.services[1].nearby).toBe(944) // Priority's first row is 8 oz
  })

  it("charges dimensional weight for boxes over 1 cubic foot (÷139)", () => {
    const large = { lengthIn: 18, widthIn: 14, heightIn: 12 } // 3024 cu in → 22 lb
    expect(dimWeightLb(large)).toBe(22)
    expect(dimWeightLb(shoe)).toBe(0)
    expect(estimateShipping(16, large)).toEqual({ ok: false, reason: "too_heavy" })
    const medium = { lengthIn: 12, widthIn: 12, heightIn: 13 } // 1872 cu in → 14 lb
    const e = estimateShipping(48, medium)
    if (!e.ok) throw new Error()
    expect(e.services[0]).toMatchObject({ nearby: 1578, dimWeightLb: 14 })
  })

  it("adds the length surcharge", () => {
    const long = estimateShipping(16, { lengthIn: 24, widthIn: 4, heightIn: 4 })
    if (!long.ok) throw new Error()
    expect(long.services[0].nearby).toBe(801 + 450)
    const veryLong = estimateShipping(16, { lengthIn: 32, widthIn: 3, heightIn: 3 })
    if (!veryLong.ok) throw new Error()
    expect(veryLong.services.map((s) => s.nearby)).toEqual([801 + 1000, 944 + 2100])
  })

  it("lists flat-rate boxes the item fits, and picks the cheapest typical price", () => {
    const e = estimateShipping(80, { lengthIn: 8, widthIn: 5, heightIn: 1.5 }) // 5 lb, fits every box
    if (!e.ok) throw new Error()
    expect(e.flatRate.map((f) => f.name)).toContain("Small Flat Rate Box")
    expect(cheapestTypical(e)).toBe(1295) // Small Flat Rate Box beats Ground Advantage zone 5 at 5 lb ($14.53)
    expect(estimateShipping(32, shoe).ok && estimateShipping(32, shoe)).toMatchObject({ flatRate: [] })
  })

  it("needs a weight and stops at 20 lb", () => {
    expect(estimateShipping(0, shoe)).toEqual({ ok: false, reason: "no_weight" })
    expect(estimateShipping(21 * 16, shoe)).toEqual({ ok: false, reason: "too_heavy" })
  })
})
