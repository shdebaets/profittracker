import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { decrypt, encrypt } from "@/lib/crypto"
import { fitWithin } from "@/lib/image"
import { challengeResponse } from "./deletion"
import { defaultConditionId, EBAY_CONDITION_ENUM, ebayTitle, ordersToSales, setupGaps, type EbayOrder } from "./mapping"

describe("ordersToSales", () => {
  const order: EbayOrder = {
    orderId: "12-34",
    creationDate: "2026-10-16T18:00:00.000Z",
    orderPaymentStatus: "PAID",
    cancelStatus: { cancelState: "NONE_REQUESTED" },
    totalMarketplaceFee: { value: "9.00" },
    lineItems: [
      { lineItemId: "a", sku: "item-1", quantity: 2, lineItemCost: { value: "40.00" }, deliveryCost: { shippingCost: { value: "5.00" } } },
      { lineItemId: "b", sku: "item-2", quantity: 1, lineItemCost: { value: "15.00" } },
      { lineItemId: "c", quantity: 1, lineItemCost: { value: "30.00" } }, // listed outside FlipLedger (no SKU)
    ],
  }

  it("maps lines to per-unit sales and splits the real fee by line value", () => {
    const [a, b] = ordersToSales([order])
    expect(a).toMatchObject({ itemId: "item-1", quantity: 2, salePriceCents: 2000, buyerShippingCents: 500, soldAt: order.creationDate })
    // total value 45 + 15 + 30 = 90; fee 900¢ → a: 450, b: 150
    expect(a.feeCents).toBe(450)
    expect(b).toMatchObject({ itemId: "item-2", salePriceCents: 1500, feeCents: 150 })
    expect(ordersToSales([order])).toHaveLength(2)
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
