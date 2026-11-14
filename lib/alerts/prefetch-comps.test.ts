import { describe, expect, it } from "vitest"
import { soldKey } from "@/lib/comps/sold-api"
import { pickStale } from "./prefetch-comps"

const now = new Date("2026-11-14T13:00:00Z")
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()

describe("pickStale", () => {
  it("skips fresh reads, puts never-read first, then oldest, and de-duplicates titles", () => {
    const titles = ["Nike Air Max 90", "NEW Nike Air Max 90", "Lego 10294 Titanic", "Stanley Quencher 40oz", "Yeti Rambler"]
    const last = new Map([
      [soldKey("Lego 10294 Titanic"), daysAgo(2)], // fresh
      [soldKey("Stanley Quencher 40oz"), daysAgo(30)],
      [soldKey("Yeti Rambler"), daysAgo(9)],
    ])
    expect(pickStale(titles, last, now, 10).map((p) => p.query)).toEqual(["Nike Air Max 90", "Stanley Quencher 40oz", "Yeti Rambler"])
  })

  it("respects the limit", () => {
    expect(pickStale(["Alpha one", "Bravo two", "Charlie three"], new Map(), now, 2)).toHaveLength(2)
  })
})
