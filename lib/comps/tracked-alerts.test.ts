import { describe, expect, it } from "vitest"
import { soldMedianOf, trackedAlert } from "./tracked-alerts"
import { trackedPush } from "@/lib/push/comp-messages"

describe("tracked product alerts", () => {
  it("uses the 30-day sold median, else 90-day", () => {
    expect(soldMedianOf({ soldMedian30: 1000, soldMedian90: 900 })).toBe(1000)
    expect(soldMedianOf({ soldMedian30: null, soldMedian90: 900 })).toBe(900)
    expect(soldMedianOf(null)).toBeNull()
  })
  it("first check sets the baseline without alerting", () => {
    expect(trackedAlert({ targetCents: null, baselineCents: null, prevMedianCents: null, medianCents: 5000 })).toEqual({ alert: null, baselineCents: 5000 })
  })
  it("alerts when the median crosses under the target buy price", () => {
    const r = trackedAlert({ targetCents: 3000, baselineCents: 3200, prevMedianCents: 3100, medianCents: 2900 })
    expect(r.alert?.kind).toBe("below_target")
    expect(r.baselineCents).toBe(2900)
  })
  it("doesn't repeat the target alert while it stays under", () => {
    expect(trackedAlert({ targetCents: 3000, baselineCents: 2900, prevMedianCents: 2900, medianCents: 2850 }).alert).toBeNull()
  })
  it("a median exactly at the target isn't below it", () => {
    expect(trackedAlert({ targetCents: 3000, baselineCents: 3100, prevMedianCents: 3100, medianCents: 3000 }).alert).toBeNull()
  })
  it("15% is not enough, just over 15% alerts", () => {
    expect(trackedAlert({ targetCents: null, baselineCents: 10000, prevMedianCents: 10000, medianCents: 11500 }).alert).toBeNull()
    expect(trackedAlert({ targetCents: null, baselineCents: 10000, prevMedianCents: 10000, medianCents: 8500 }).alert).toBeNull()
    const up = trackedAlert({ targetCents: null, baselineCents: 10000, prevMedianCents: 11000, medianCents: 11501 })
    expect(up.alert).toMatchObject({ kind: "up", fromCents: 10000, toCents: 11501 })
    expect(up.baselineCents).toBe(11501)
    expect(trackedAlert({ targetCents: null, baselineCents: 10000, prevMedianCents: 9000, medianCents: 8400 }).alert?.kind).toBe("down")
  })
  it("a slow slide adds up from the baseline, which stays put until an alert", () => {
    const a = trackedAlert({ targetCents: null, baselineCents: 10000, prevMedianCents: 10000, medianCents: 9200 })
    expect(a).toEqual({ alert: null, baselineCents: 10000 })
    expect(trackedAlert({ targetCents: null, baselineCents: a.baselineCents, prevMedianCents: 9200, medianCents: 8400 }).alert?.kind).toBe("down")
  })
  it("no sold median: nothing", () => {
    expect(trackedAlert({ targetCents: 3000, baselineCents: 4000, prevMedianCents: 4000, medianCents: null })).toEqual({ alert: null, baselineCents: 4000 })
  })
  it("writes the push", () => {
    const m = trackedPush("Pokemon UPC Night", { kind: "down", fromCents: 40000, toCents: 33000, pct: -0.18 }, null)
    expect(m.body).toBe("Pokemon UPC Night sold median $400.00 → $330.00 (-18%).")
    expect(m.url).toBe("/comp?q=Pokemon%20UPC%20Night")
    expect(trackedPush("X", { kind: "below_target", fromCents: 3100, toCents: 2900, pct: null }, 3000).body).toContain("below your $30.00 target")
  })
})
