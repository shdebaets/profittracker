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

/** Inventory API ConditionEnum. Some categories reject some values; eBay's error is shown to the user then. */
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
  cancelStatus?: { cancelState?: string }
  totalMarketplaceFee?: { value: string }
  lineItems: {
    lineItemId: string
    sku?: string
    quantity: number
    lineItemCost?: { value: string }
    deliveryCost?: { shippingCost?: { value: string } }
  }[]
}

export type EbaySaleLine = {
  orderId: string
  lineItemId: string
  itemId: string
  quantity: number
  salePriceCents: number // per unit
  buyerShippingCents: number
  feeCents: number // this line's share of eBay's actual fees
  soldAt: string
}

/**
 * Turn paid, uncancelled orders into per-line sales. The order's real eBay fee
 * is split across lines by line value; SKU is our item id.
 */
export function ordersToSales(orders: EbayOrder[]): EbaySaleLine[] {
  const out: EbaySaleLine[] = []
  for (const o of orders) {
    if (o.orderPaymentStatus && o.orderPaymentStatus !== "PAID") continue
    if (o.cancelStatus?.cancelState === "CANCELED") continue
    const lines = o.lineItems.filter((l) => l.sku)
    const value = (l: EbayOrder["lineItems"][number]) => cents(l.lineItemCost) + cents(l.deliveryCost?.shippingCost)
    const total = o.lineItems.reduce((a, l) => a + value(l), 0)
    const fee = cents(o.totalMarketplaceFee)
    for (const l of lines) {
      const qty = Math.max(1, l.quantity)
      out.push({
        orderId: o.orderId,
        lineItemId: l.lineItemId,
        itemId: l.sku!,
        quantity: qty,
        salePriceCents: Math.round(cents(l.lineItemCost) / qty),
        buyerShippingCents: cents(l.deliveryCost?.shippingCost),
        feeCents: total > 0 ? Math.round((fee * value(l)) / total) : 0,
        soldAt: o.creationDate,
      })
    }
  }
  return out
}
