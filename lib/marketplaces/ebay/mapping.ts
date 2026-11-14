// Pure eBay <-> FlipLedger mappings (no I/O), shared by server code, UI and tests.
import type { ItemCondition } from "@/lib/marketplaces/registry"
import type { EbaySettings } from "@/lib/types"

/** What's still missing before this account can publish listings. */
export function setupGaps(s: EbaySettings): string[] {
  const gaps: string[] = []
  if (!s.fulfillmentPolicyId) gaps.push("a shipping policy")
  if (!s.paymentPolicyId) gaps.push("a payment policy")
  if (!s.returnPolicyId) gaps.push("a return policy")
  if (!s.merchantLocationKey) gaps.push("your ship-from ZIP code")
  return gaps
}

export type PolicyType = "fulfillment" | "payment" | "return"

/** Policy types the account hasn't picked yet; these are the ones "Set up policies for me" creates. */
export function missingPolicies(s: EbaySettings): PolicyType[] {
  const out: PolicyType[] = []
  if (!s.fulfillmentPolicyId) out.push("fulfillment")
  if (!s.paymentPolicyId) out.push("payment")
  if (!s.returnPolicyId) out.push("return")
  return out
}

export type PolicyChoices = {
  shipping: { free: boolean; costCents: number; handlingDays: 1 | 2 | 3 }
  returns: { accepted: boolean }
}

export const POLICY_NAMES: Record<PolicyType, string> = {
  fulfillment: "FlipLedger shipping",
  payment: "FlipLedger payment",
  return: "FlipLedger returns",
}

/**
 * Account API bodies for simple starter policies (marketplaceId is added by the caller).
 * USPS Ground Advantage's service code is USPSParcel: eBay reused the Parcel Select code,
 * and the Metadata API's get_shipping_services lists it that way for EBAY_US.
 */
export function policyBodies(c: PolicyChoices): Record<PolicyType, Record<string, unknown>> {
  const categoryTypes = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }]
  return {
    fulfillment: {
      name: POLICY_NAMES.fulfillment,
      categoryTypes,
      handlingTime: { value: c.shipping.handlingDays, unit: "DAY" },
      shippingOptions: [
        {
          optionType: "DOMESTIC",
          costType: "FLAT_RATE",
          shippingServices: [
            {
              sortOrder: 1,
              shippingCarrierCode: "USPS",
              shippingServiceCode: "USPSParcel",
              freeShipping: c.shipping.free,
              shippingCost: toEbayMoney(c.shipping.free ? 0 : c.shipping.costCents),
            },
          ],
        },
      ],
    },
    // eBay manages payments, so a payment policy only says "pay right away".
    payment: { name: POLICY_NAMES.payment, categoryTypes, immediatePay: true },
    return: c.returns.accepted
      ? {
          name: POLICY_NAMES.return,
          categoryTypes,
          returnsAccepted: true,
          returnPeriod: { value: 30, unit: "DAY" },
          returnShippingCostPayer: "BUYER",
          refundMethod: "MONEY_BACK",
        }
      : { name: POLICY_NAMES.return, categoryTypes, returnsAccepted: false },
  }
}

/**
 * eBay condition IDs (what a category's condition policy lists) → Inventory API ConditionEnum.
 * Each category allows only some of these, e.g. shoes: 1000/1500/1750/3000; apparel: 1000/1500/1750/2990/3000/3010.
 */
export const EBAY_CONDITION_ENUM: Record<string, string> = {
  "1000": "NEW",
  "1500": "NEW_OTHER",
  "1750": "NEW_WITH_DEFECTS",
  "2000": "CERTIFIED_REFURBISHED",
  "2010": "EXCELLENT_REFURBISHED",
  "2020": "VERY_GOOD_REFURBISHED",
  "2030": "GOOD_REFURBISHED",
  "2500": "SELLER_REFURBISHED",
  "2750": "LIKE_NEW",
  "2990": "PRE_OWNED_EXCELLENT",
  "3000": "USED_EXCELLENT",
  "3010": "PRE_OWNED_FAIR",
  "4000": "USED_VERY_GOOD",
  "5000": "USED_GOOD",
  "6000": "USED_ACCEPTABLE",
  "7000": "FOR_PARTS_OR_NOT_WORKING",
}

/** Closest eBay condition IDs for a FlipLedger condition, best first. */
const PREFERRED_CONDITION_IDS: Record<ItemCondition, string[]> = {
  new_with_tags: ["1000"],
  new: ["1500", "1000"],
  like_new: ["2750", "2990", "3000", "4000"],
  good: ["5000", "3000", "4000", "2990"],
  fair: ["6000", "3010", "3000"],
}

/** Pre-select the allowed eBay condition closest to the item's; null when nothing is a clear match. */
export function defaultConditionId(condition: ItemCondition | null | undefined, allowedIds: string[]): string | null {
  if (!condition) return null
  return PREFERRED_CONDITION_IDS[condition].find((id) => allowedIds.includes(id)) ?? null
}

/** Fallback when no category-specific condition was chosen. Some categories reject some values. */
export const EBAY_CONDITION: Record<ItemCondition, string> = {
  new_with_tags: "NEW",
  new: "NEW_OTHER",
  like_new: "USED_EXCELLENT",
  good: "USED_GOOD",
  fair: "USED_ACCEPTABLE",
}

export const EBAY_TITLE_MAX = 80

export function ebayTitle(title: string) {
  const t = title.trim().replace(/\s+/g, " ")
  return t.length <= EBAY_TITLE_MAX ? t : t.slice(0, EBAY_TITLE_MAX - 1).trimEnd() + "…"
}

export const toEbayMoney = (cents: number) => ({ value: (cents / 100).toFixed(2), currency: "USD" })
const cents = (m?: { value?: string }) => (m?.value ? Math.round(Number(m.value) * 100) : 0)

export type EbayOrder = {
  orderId: string
  creationDate: string
  orderPaymentStatus?: string
  /** NOT_STARTED, IN_PROGRESS or FULFILLED. */
  orderFulfillmentStatus?: string
  buyer?: { username?: string }
  cancelStatus?: { cancelState?: string }
  totalMarketplaceFee?: { value: string }
  lineItems: {
    lineItemId: string
    sku?: string
    title?: string
    legacyItemId?: string
    quantity: number
    lineItemCost?: { value: string }
    deliveryCost?: { shippingCost?: { value: string } }
    lineItemFulfillmentInstructions?: { shipByDate?: string }
  }[]
}

// ---- Promoted Listings (cost per sale) ----

export const EBAY_MARKETING_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.marketing"

/** Sellers who connected before promoting existed must reconnect to grant sell.marketing. */
export const canPromote = (scopes: string[] | null | undefined) => !!scopes?.includes(EBAY_MARKETING_SCOPE)

export const AD_RATE_MIN = 2
export const AD_RATE_MAX = 100
export const AD_RATE_DEFAULT = 2

/** eBay takes 2.0–100.0 with at most one decimal place. Returns null when out of range. */
export function normalizeAdRate(rate: number): number | null {
  if (!Number.isFinite(rate)) return null
  const r = Math.round(rate * 10) / 10
  return r >= AD_RATE_MIN && r <= AD_RATE_MAX ? r : null
}

/** The bidPercentage string eBay expects, e.g. 2 → "2.0". */
export const formatAdRate = (rate: number) => rate.toFixed(1)

/**
 * Estimated Promoted Listings fee for a sale: the ad rate times what the buyer paid
 * (item and shipping). eBay only charges it when the sale came through the ad, and
 * also counts sales tax, so this is an estimate.
 */
export function adFeeCents(rate: number | null | undefined, line: Pick<EbaySaleLine, "salePriceCents" | "quantity" | "buyerShippingCents">) {
  if (!rate) return 0
  return Math.round((rate / 100) * (line.salePriceCents * line.quantity + line.buyerShippingCents))
}

export type EbaySaleLine = {
  orderId: string
  lineItemId: string
  /** The listing's SKU: our item id when it was listed through FlipLedger, else the seller's own SKU or null. */
  sku: string | null
  title: string
  /** eBay's listing number, for a link to the listing. */
  listingId: string | null
  quantity: number
  salePriceCents: number // per unit
  buyerShippingCents: number
  feeCents: number // this line's share of eBay's actual fees
  soldAt: string
  /** The buyer's eBay username. Never their address. */
  buyer: string | null
  shipBy: string | null
  /** eBay's orderFulfillmentStatus. */
  fulfillment: string | null
}

/**
 * Turn paid, uncancelled orders into per-line sales. The order's real eBay fee
 * is split across lines by line value. Lines listed through FlipLedger carry our
 * item id as SKU; the rest (listed straight on eBay) come through too, by title.
 */
export function ordersToSales(orders: EbayOrder[]): EbaySaleLine[] {
  const out: EbaySaleLine[] = []
  for (const o of orders) {
    if (o.orderPaymentStatus && o.orderPaymentStatus !== "PAID") continue
    if (o.cancelStatus?.cancelState === "CANCELED") continue
    const value = (l: EbayOrder["lineItems"][number]) => cents(l.lineItemCost) + cents(l.deliveryCost?.shippingCost)
    const total = o.lineItems.reduce((a, l) => a + value(l), 0)
    const fee = cents(o.totalMarketplaceFee)
    for (const l of o.lineItems) {
      const qty = Math.max(1, l.quantity)
      out.push({
        orderId: o.orderId,
        lineItemId: l.lineItemId,
        sku: l.sku?.trim() || null,
        title: (l.title ?? "").trim().replace(/\s+/g, " ").slice(0, 200),
        listingId: l.legacyItemId ?? null,
        quantity: qty,
        salePriceCents: Math.round(cents(l.lineItemCost) / qty),
        buyerShippingCents: cents(l.deliveryCost?.shippingCost),
        feeCents: total > 0 ? Math.round((fee * value(l)) / total) : 0,
        soldAt: o.creationDate,
        buyer: o.buyer?.username ?? null,
        shipBy: l.lineItemFulfillmentInstructions?.shipByDate ?? null,
        fulfillment: o.orderFulfillmentStatus ?? null,
      })
    }
  }
  return out
}

/** An eBay order's page in Seller Hub. */
export const ebayOrderUrl = (orderId: string) => `https://www.ebay.com/sh/ord/details?orderid=${encodeURIComponent(orderId)}`
