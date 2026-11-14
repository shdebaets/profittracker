import { describe, expect, it } from "vitest"
import { overpricedItems } from "./overpriced"
import type { Item } from "@/lib/types"

const item = (id: string, price: number | null, status = "inventory") =>
  ({ id, seq: 1, title: id, status, list_price_cents: price, listings: [] }) as unknown as Item

describe("overpricedItems", () => {
  it("flags items 25%+ above the sold median, worst first", () => {
    const medians = new Map([["a", 2000], ["b", 2000], ["c", 2000], ["d", 2000]])
    const out = overpricedItems([item("a", 2400), item("b", 2500), item("c", 4000), item("d", 4000, "sold")], medians)
    expect(out.map((o) => o.itemId)).toEqual(["c", "b"])
    expect(out[0].overBy).toBeCloseTo(1)
  })
})
