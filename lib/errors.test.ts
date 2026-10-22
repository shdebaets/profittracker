import { describe, expect, it } from "vitest"
import { z } from "zod"
import { friendlyError, GENERIC_ERROR, UserError } from "./errors"

class EbayError extends Error {
  name = "EbayError"
  constructor(message: string, readonly status: number, readonly errors: object[] = []) {
    super(message)
  }
}
const ebay = (status: number, longMessage: string, errorId = 25000) =>
  new EbayError(longMessage, status, [{ errorId, message: longMessage, longMessage }])

describe("friendlyError", () => {
  it("passes our own messages through", () => {
    expect(friendlyError(new UserError("Give the item a title first."))).toBe("Give the item a title first.")
  })

  it("hides technical errors and env/config details", () => {
    const msg = friendlyError(new Error("TOKEN_ENCRYPTION_KEY is not set"))
    expect(msg).not.toMatch(/TOKEN|KEY/)
    expect(msg).toMatch(/our side/)
    expect(friendlyError(new SyntaxError("Unexpected token < in JSON"))).toMatch(/our side/)
    expect(friendlyError(null)).toBe(GENERIC_ERROR)
  })

  describe("eBay", () => {
    it("the errors seen in production", () => {
      expect(friendlyError(ebay(400, "Invalid value for header Accept-Language."))).toMatch(/our side/)
      expect(
        friendlyError(ebay(400, "The eBay listing associated with the inventory item, or the unpublished offer has an invalid picture URL. The length of each Picture URL must be within 500 characters")),
      ).toMatch(/photos/)
    })
    it("auth, rate limit, outage", () => {
      expect(friendlyError(ebay(401, "Invalid access token", 1001))).toMatch(/Reconnect eBay/)
      expect(friendlyError(ebay(429, "Too many requests"))).toMatch(/busy/)
      expect(friendlyError(ebay(500, "System error", 25001))).toMatch(/trouble/)
    })
    it("listing problems point at the fix", () => {
      expect(friendlyError(ebay(400, "The item specific Brand is missing."))).toMatch(/^eBay needs more item specifics: The item specific Brand is missing\.$/)
      expect(friendlyError(ebay(400, "Invalid category ID."))).toMatch(/category/)
      expect(friendlyError(ebay(400, "Fulfillment policy is not valid."))).toMatch(/policies/)
      expect(friendlyError(ebay(400, "Condition is not supported for this category."))).toMatch(/condition/)
    })
    it("anything else keeps eBay's first sentence", () => {
      expect(friendlyError(ebay(400, "Your seller account is restricted. See Seller Hub. More text."))).toBe(
        "eBay couldn't do that: Your seller account is restricted.",
      )
    })
  })

  it("database errors", () => {
    expect(friendlyError({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" })).toMatch(/couldn't find/)
    expect(friendlyError({ code: "23505", message: "duplicate key value" })).toBe("That already exists.")
    expect(friendlyError({ code: "42501", message: "new row violates row-level security policy" })).toMatch(/access/)
  })

  it("sign-in errors", () => {
    expect(friendlyError({ name: "AuthApiError", code: "invalid_credentials", message: "Invalid login credentials" })).toMatch(/don't match/)
    expect(friendlyError({ name: "AuthApiError", code: "email_not_confirmed", message: "Email not confirmed" })).toMatch(/Confirm your email/)
    expect(friendlyError({ name: "AuthApiError", code: "over_email_send_rate_limit", message: "x" })).toMatch(/Too many/)
  })

  it("network and photo errors", () => {
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatch(/internet connection/)
    expect(friendlyError(new TypeError("fetch failed"))).toMatch(/internet connection/)
    expect(friendlyError(new DOMException("The source image could not be decoded.", "EncodingError"))).toMatch(/photo couldn't be read/)
    expect(friendlyError({ name: "StorageApiError", message: "Object not found" })).toMatch(/photo is no longer available/)
  })

  it("form validation: custom messages shown, zod defaults reworded", () => {
    const custom = z.object({ zip: z.string().regex(/^\d{5}$/, "Enter a 5-digit ZIP code") }).safeParse({ zip: "x" })
    expect(friendlyError(custom.error)).toBe("Enter a 5-digit ZIP code")
    const dflt = z.object({ quantity: z.number().int().min(1) }).safeParse({ quantity: 0 })
    expect(friendlyError(dflt.error)).toBe("Please check the quantity and try again.")
    const cents = z.object({ salePriceCents: z.number() }).safeParse({ salePriceCents: "x" })
    expect(friendlyError(cents.error)).toBe("Please check the sale price and try again.")
  })
})
