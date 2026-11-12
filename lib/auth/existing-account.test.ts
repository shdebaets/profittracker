import { describe, expect, it } from "vitest"
import { isExistingAccount } from "./existing-account"

describe("isExistingAccount", () => {
  it("flags Supabase's obfuscated user for a registered email", () => {
    expect(isExistingAccount({ identities: [] })).toBe(true)
  })
  it("passes a real new user", () => {
    expect(isExistingAccount({ identities: [{ provider: "email" }] })).toBe(false)
  })
  it("passes when there's no user or no identities field", () => {
    expect(isExistingAccount(null)).toBe(false)
    expect(isExistingAccount({})).toBe(false)
  })
})
