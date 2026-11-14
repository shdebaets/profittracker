import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const { monthlyToRetire, pickRenewing } = await import("./billing")

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
