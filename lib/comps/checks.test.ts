import { describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }))
const { resetsIn, compChecksPerDay } = await import("./checks")

describe("comp checks", () => {
  it("says when the next check frees up", () => {
    expect(resetsIn(1_000 + 30 * 60_000, 1_000)).toBe("in about 30 minutes")
    expect(resetsIn(1_000 + 60_000, 1_000)).toBe("in about 1 minute")
    expect(resetsIn(3 * 3_600_000 + 10 * 60_000, 0)).toBe("in about 3 hours")
    expect(resetsIn(90 * 60_000, 0)).toBe("in about 2 hours")
  })
  it("defaults to 5 a day", () => {
    delete process.env.COMP_CHECKS_PER_DAY
    expect(compChecksPerDay()).toBe(5)
  })
})
