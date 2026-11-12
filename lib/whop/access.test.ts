import { describe, expect, it } from "vitest"
import { ACCESS_TTL_MS, decideCached, grantsAccess, type AccessRow } from "./access"

const now = Date.parse("2026-11-05T12:00:00Z")
const cfg = { productIds: ["prod_a"], freeEmails: ["nick@example.com"] }
const row = (has_access: boolean, agoMs: number | null): AccessRow => ({
  whop_user_id: "user_x",
  has_access,
  checked_at: agoMs === null ? null : new Date(now - agoMs).toISOString(),
})

describe("decideCached", () => {
  it("lets allowlisted emails in, case-insensitively, even without a Whop link", () => {
    expect(decideCached(cfg, "Nick@Example.com", null, now)).toBe(true)
  })
  it("is open to everyone while no product is configured", () => {
    expect(decideCached({ ...cfg, productIds: [] }, "a@b.c", null, now)).toBe(true)
  })
  it("refuses users who never signed in with Whop", () => {
    expect(decideCached(cfg, "a@b.c", null, now)).toBe(false)
  })
  it("uses a fresh cached answer", () => {
    expect(decideCached(cfg, "a@b.c", row(true, 60_000), now)).toBe(true)
    expect(decideCached(cfg, "a@b.c", row(false, 60_000), now)).toBe(false)
  })
  it("asks Whop when the answer is stale or was never checked", () => {
    expect(decideCached(cfg, "a@b.c", row(true, ACCESS_TTL_MS + 1), now)).toBe("check")
    expect(decideCached(cfg, "a@b.c", row(false, null), now)).toBe("check")
  })
})

describe("grantsAccess", () => {
  it("counts customers and business admins", () => {
    expect(grantsAccess({ has_access: true, access_level: "customer" })).toBe(true)
    expect(grantsAccess({ has_access: false, access_level: "admin" })).toBe(true)
    expect(grantsAccess({ has_access: false, access_level: "no_access" })).toBe(false)
    expect(grantsAccess({})).toBe(false)
  })
})
