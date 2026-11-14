import { describe, expect, it } from "vitest"
import { planReprice, validChange } from "./reprice"
import { repriced } from "./stale"

const rows = [
  { id: "a", priceCents: 4000 },
  { id: "b", priceCents: 150 },
  { id: "c", priceCents: null },
]

describe("repriced", () => {
  it("drops by percent, rounding to cents", () => expect(repriced(3333, { mode: "percent", value: 15 })).toBe(2833))
  it("drops by an amount", () => expect(repriced(4000, { mode: "amount", value: 500 })).toBe(3500))
  it("sets a price", () => expect(repriced(4000, { mode: "set", value: 2599 })).toBe(2599))
  it("never goes under $0.99", () => {
    expect(repriced(150, { mode: "amount", value: 500 })).toBe(99)
    expect(repriced(100, { mode: "percent", value: 90 })).toBe(99)
    expect(repriced(4000, { mode: "set", value: 10 })).toBe(99)
  })
})

describe("planReprice", () => {
  it("percent: skips items without a price", () => {
    const p = planReprice(rows, { mode: "percent", value: 20 })
    expect(p.changes).toEqual([
      { id: "a", from: 4000, to: 3200 },
      { id: "b", from: 150, to: 120 },
    ])
    expect(p.noPrice).toEqual(["c"])
  })

  it("amount: floors at $0.99", () => {
    expect(planReprice(rows, { mode: "amount", value: 1000 }).changes.map((c) => c.to)).toEqual([3000, 99])
  })

  it("set: prices items that had none", () => {
    const p = planReprice(rows, { mode: "set", value: 2500 })
    expect(p.changes.map((c) => c.id)).toEqual(["a", "b", "c"])
    expect(p.noPrice).toEqual([])
  })

  it("suggested: each item gets its own median, others are skipped", () => {
    const p = planReprice(rows, { mode: "suggested" }, { a: 2950, c: 1200 })
    expect(p.changes).toEqual([
      { id: "a", from: 4000, to: 2950 },
      { id: "c", from: null, to: 1200 },
    ])
    expect(p.noSuggestion).toEqual(["b"])
  })

  it("leaves items already at the new price alone", () => {
    const p = planReprice(rows, { mode: "set", value: 4000 })
    expect(p.unchanged).toEqual(["a"])
    expect(p.changes.map((c) => c.id)).toEqual(["b", "c"])
  })
})

describe("validChange", () => {
  it("checks the value for the mode", () => {
    expect(validChange({ mode: "suggested" })).toBe(true)
    expect(validChange({ mode: "percent", value: 0 })).toBe(false)
    expect(validChange({ mode: "percent", value: 91 })).toBe(false)
    expect(validChange({ mode: "percent", value: 15 })).toBe(true)
    expect(validChange({ mode: "amount", value: 0 })).toBe(false)
    expect(validChange({ mode: "set", value: 1999 })).toBe(true)
  })
})
