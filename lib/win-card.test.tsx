import { test, expect } from "vitest"
import { winCard } from "@/lib/win-card"
test("win card renders", async () => {
  const r = winCard({ name: "Nick", month: "November 2026", profit: 123456, itemsSold: 12, miles: 40 })
  const buf = await r.arrayBuffer()
  expect(buf.byteLength).toBeGreaterThan(1000)
})
