import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { decrypt, encrypt } from "@/lib/crypto"
import { fitWithin } from "@/lib/image"
import { challengeResponse } from "./deletion"
import { adFeeCents, canPromote, defaultConditionId, EBAY_CONDITION_ENUM, EBAY_MARKETING_SCOPE, formatAdRate, normalizeAdRate, ebayTitle, missingPolicies, ordersToSales, policyBodies, setupGaps, type EbayOrder } from "./mapping"

describe("ordersToSales", () => {
  const order: EbayOrder = {
    orderId: "12-34",
    creationDate: "2026-10-16T18:00:00.000Z",
    orderPaymentStatus: "PAID",
    cancelStatus: { cancelState: "NONE_REQUESTED" },
    totalMarketplaceFee: { value: "9.00" },
    lineItems: [
      { lineItemId: "a", sku: "item-1", title: "Nike Hoodie", quantity: 2, lineItemCost: { value: "40.00" }, deliveryCost: { shippingCost: { value: "5.00" } } },
      { lineItemId: "b", sku: "item-2", quantity: 1, lineItemCost: { value: "15.00" } },
      // Listed straight on eBay (no SKU).
      { lineItemId: "c", title: "  Levi's  501 Jeans ", legacyItemId: "1234567890", quantity: 1, lineItemCost: { value: "30.00" } },
    ],
  }

  it("maps lines to per-unit sales and splits the real fee by line value", () => {
    const [a, b] = ordersToSales([order])
    expect(a).toMatchObject({ sku: "item-1", title: "Nike Hoodie", quantity: 2, salePriceCents: 2000, buyerShippingCents: 500, soldAt: order.creationDate })
    // total value 45 + 15 + 30 = 90; fee 900¢ → a: 450, b: 150
    expect(a.feeCents).toBe(450)
    expect(b).toMatchObject({ sku: "item-2", title: "", salePriceCents: 1500, feeCents: 150 })
  })

  it("keeps lines listed outside FlipLedger, with their title and eBay item number", () => {
    const lines = ordersToSales([order])
    expect(lines).toHaveLength(3)
    expect(lines[2]).toMatchObject({ sku: null, title: "Levi's 501 Jeans", listingId: "1234567890", salePriceCents: 3000, feeCents: 300 })
  })

  it("skips unpaid and cancelled orders", () => {
    expect(ordersToSales([{ ...order, orderPaymentStatus: "PENDING" }])).toEqual([])
    expect(ordersToSales([{ ...order, cancelStatus: { cancelState: "CANCELED" } }])).toEqual([])
  })
})

describe("eBay conditions per category", () => {
  const shoes = ["1000", "1500", "1750", "3000"] // e.g. Athletic Shoes
  const apparel = ["1000", "1500", "1750", "2990", "3000", "3010"]
  const electronics = ["1000", "1500", "2000", "2500", "3000", "7000"]

  it("picks the closest condition the category allows", () => {
    expect(defaultConditionId("new_with_tags", shoes)).toBe("1000")
    expect(defaultConditionId("new", shoes)).toBe("1500")
    expect(defaultConditionId("good", shoes)).toBe("3000") // shoes have no USED_GOOD (5000): the error seen
    expect(defaultConditionId("like_new", apparel)).toBe("2990")
    expect(defaultConditionId("fair", apparel)).toBe("3010")
    expect(defaultConditionId("good", electronics)).toBe("3000")
  })

  it("leaves it for the seller when nothing fits or no condition is set", () => {
    expect(defaultConditionId(null, shoes)).toBeNull()
    expect(defaultConditionId("fair", ["1000", "1500"])).toBeNull()
  })

  it("every ID maps to an Inventory API condition", () => {
    for (const id of [...shoes, ...apparel, ...electronics]) expect(EBAY_CONDITION_ENUM[id]).toBeTruthy()
  })
})

describe("eBay helpers", () => {
  it("trims titles to 80 characters", () => {
    expect(ebayTitle("  Nike   Air Max  ")).toBe("Nike Air Max")
    const long = ebayTitle("x".repeat(100))
    expect(long).toHaveLength(80)
    expect(long.endsWith("…")).toBe(true)
  })

  it("lists what setup is missing", () => {
    expect(setupGaps({})).toHaveLength(4)
    expect(setupGaps({ fulfillmentPolicyId: "1", paymentPolicyId: "2", returnPolicyId: "3", merchantLocationKey: "k" })).toEqual([])
  })

  it("answers the account-deletion challenge as sha256(code + token + endpoint)", () => {
    const expected = createHash("sha256").update("abc" + "tok" + "https://x.test/e").digest("hex")
    expect(challengeResponse("abc", "tok", "https://x.test/e")).toBe(expected)
  })
})

describe("crypto", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("refresh-token", "secret")
    expect(a).not.toBe(encrypt("refresh-token", "secret"))
    expect(decrypt(a, "secret")).toBe("refresh-token")
  })

  it("rejects the wrong key or tampering", () => {
    const a = encrypt("tok", "secret")
    expect(() => decrypt(a, "other")).toThrow()
    const parts = a.split(".")
    parts[3] = Buffer.from("evil").toString("base64url")
    expect(() => decrypt(parts.join("."), "secret")).toThrow()
  })
})

describe("fitWithin", () => {
  it("scales the long edge down to 1600 and never upscales", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })
})

describe("starter business policies", () => {
  const base = { shipping: { free: false, costCents: 899, handlingDays: 2 as const }, returns: { accepted: true } }
  const ship = (b: Record<string, unknown>) =>
    (b.shippingOptions as { shippingServices: Record<string, unknown>[] }[])[0].shippingServices[0]

  it("charges the buyer a flat USPS Ground Advantage rate", () => {
    const { fulfillment } = policyBodies(base)
    expect(fulfillment.handlingTime).toEqual({ value: 2, unit: "DAY" })
    expect(ship(fulfillment)).toMatchObject({
      shippingCarrierCode: "USPS",
      shippingServiceCode: "USPSParcel",
      freeShipping: false,
      shippingCost: { value: "8.99", currency: "USD" },
    })
  })

  it("offers free shipping at $0", () => {
    const { fulfillment } = policyBodies({ ...base, shipping: { ...base.shipping, free: true } })
    expect(ship(fulfillment)).toMatchObject({ freeShipping: true, shippingCost: { value: "0.00" } })
  })

  it("builds 30-day buyer-paid returns or no returns", () => {
    expect(policyBodies(base).return).toMatchObject({
      returnsAccepted: true,
      returnPeriod: { value: 30, unit: "DAY" },
      returnShippingCostPayer: "BUYER",
    })
    const none = policyBodies({ ...base, returns: { accepted: false } }).return
    expect(none).toMatchObject({ returnsAccepted: false })
    expect(none).not.toHaveProperty("returnPeriod")
  })

  it("only creates the policies that aren't picked yet", () => {
    expect(missingPolicies({})).toEqual(["fulfillment", "payment", "return"])
    expect(missingPolicies({ fulfillmentPolicyId: "1", returnPolicyId: "3" })).toEqual(["payment"])
  })
})

describe("Promoted Listings", () => {
  it("keeps ad rates eBay accepts: 2.0 to 100.0, one decimal", () => {
    expect(normalizeAdRate(2)).toBe(2)
    expect(normalizeAdRate(2.25)).toBe(2.3)
    expect(normalizeAdRate(1.9)).toBeNull()
    expect(normalizeAdRate(100.04)).toBe(100)
    expect(normalizeAdRate(100.1)).toBeNull()
    expect(normalizeAdRate(Number.NaN)).toBeNull()
    expect(formatAdRate(2)).toBe("2.0")
    expect(formatAdRate(12.5)).toBe("12.5")
  })
  it("estimates the ad fee on what the buyer paid", () => {
    // 2% of (2 x $25 + $8 shipping) = $1.16
    expect(adFeeCents(2, { salePriceCents: 2500, quantity: 2, buyerShippingCents: 800 })).toBe(116)
    expect(adFeeCents(null, { salePriceCents: 2500, quantity: 1, buyerShippingCents: 0 })).toBe(0)
  })
  it("needs the marketing scope, which old connections don't have", () => {
    expect(canPromote(null)).toBe(false)
    expect(canPromote(["https://api.ebay.com/oauth/api_scope"])).toBe(false)
    expect(canPromote([EBAY_MARKETING_SCOPE])).toBe(true)
  })
})
