import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const { monthlyToRetire, pickRenewing, showYearlyBanner, yearlySeason } = await import("./billing")

const m = (id: string, plan: string, status = "active", cancel = false) => ({
  id, status, cancel_at_period_end: cancel, renewal_period_end: null, plan: { id: plan }, product: { id: "prod_x" },
})

describe("pickRenewing", () => {
  it("prefers a membership that isn't already cancelling and labels the plan", () => {
    const p = pickRenewing([m("a", "plan_month", "active", true), m("b", "plan_year")], "plan_year")
    expect(p).toMatchObject({ kind: "yearly", membership: { id: "b" } })
    expect(pickRenewing([m("a", "plan_month")], "plan_year")?.kind).toBe("monthly")
  })
  it("ignores memberships that are over", () => {
    expect(pickRenewing([m("a", "plan_month", "expired")], "plan_year")).toBeNull()
  })
})

describe("monthlyToRetire", () => {
  it("retires live monthly plans once a yearly one is live", () => {
    const all = [m("mo", "plan_month"), m("yr", "plan_year"), m("old", "plan_month", "active", true)]
    expect(monthlyToRetire(all, "plan_year").map((x) => x.id)).toEqual(["mo"])
  })
  it("does nothing without a live yearly plan", () => {
    expect(monthlyToRetire([m("mo", "plan_month"), m("yr", "plan_year", "active", true)], "plan_year")).toEqual([])
  })
})

describe("yearly plan banner", () => {
  const monthly = { linked: true as const, plan: "monthly" as const, membershipId: "m", renewsAt: null, canceling: false, paused: false, resumesAt: null }
  it("runs October through March", () => {
    expect([0, 1, 2, 3, 8, 9, 10, 11].map((m) => yearlySeason(new Date(2026, m, 15)))).toEqual([true, true, true, false, false, true, true, true])
  })
  it("shows only to monthly members who aren't paused, with a yearly link", () => {
    const nov = new Date(2026, 10, 14)
    expect(showYearlyBanner(monthly, "https://whop.com/x", nov)).toBe(true)
    expect(showYearlyBanner(monthly, "", nov)).toBe(false)
    expect(showYearlyBanner(monthly, "https://whop.com/x", new Date(2026, 5, 1))).toBe(false)
    expect(showYearlyBanner({ ...monthly, plan: "yearly" }, "https://whop.com/x", nov)).toBe(false)
    expect(showYearlyBanner({ ...monthly, paused: true }, "https://whop.com/x", nov)).toBe(false)
    expect(showYearlyBanner({ linked: false }, "https://whop.com/x", nov)).toBe(false)
  })
})
