// Sales of items FlipLedger didn't know about (listed straight on eBay or Mercari).
// They become sold items with an unknown cost, so the sale shows up and the seller
// adds what they paid later ("Add cost" / Needs Cost). Pure: no I/O.
import type { EbaySaleLine } from "@/lib/marketplaces/ebay/mapping"
import { listingKey } from "@/lib/import/plan"
import { marketplace } from "@/lib/marketplaces/registry"
import { presetFor } from "@/lib/profit"
import type { Platform } from "@/lib/types"

/** Columns for a new sold item. Insert it with the admin client only after scoping to user_id. */
export type SoldItemRow = {
  user_id: string
  title: string
  status: "sold"
  quantity: number
  cost_cents: 0
  cost_unknown: true
  purchased_at: string
  link_url: string | null
  sale_price_cents: number
  buyer_shipping_cents: number
  label_cost_cents: number
  fee_pct: number
  fee_fixed_cents: number
  platform: Platform
  sold_at: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** SKUs FlipLedger sets are item ids; anything else is the seller's own SKU (or none). */
export const isItemId = (sku: string | null): sku is string => !!sku && UUID.test(sku)

/**
 * A sold item for an eBay order line that isn't one of the seller's items. Uses eBay's
 * real fee for the line. A Promoted Listings fee can't be known here, so none is added.
 */
export function ebaySoldItem(line: EbaySaleLine, userId: string): SoldItemRow {
  const soldAt = new Date(line.soldAt).toISOString()
  return {
    user_id: userId,
    title: line.title || (line.listingId ? `eBay item ${line.listingId}` : `eBay order ${line.orderId}`),
    status: "sold",
    quantity: line.quantity,
    cost_cents: 0,
    cost_unknown: true,
    // Unknown; the sale date keeps it from looking bought after it sold.
    purchased_at: soldAt,
    link_url: line.listingId ? `https://www.ebay.com/itm/${line.listingId}` : null,
    sale_price_cents: line.salePriceCents,
    buyer_shipping_cents: line.buyerShippingCents,
    label_cost_cents: 0,
    fee_pct: 0,
    fee_fixed_cents: line.feeCents,
    platform: "ebay",
    sold_at: soldAt,
  }
}

/** A sold Mercari listing read by the extension from the seller's sold list. */
export type MarketplaceSale = {
  marketplace: "mercari"
  /** Mercari's own item ID (m123…). */
  externalId: string
  url: string
  title: string
  priceCents: number | null
  /** When it sold, if the page said; otherwise the time it was recorded. */
  soldAt: string | null
  photoUrl: string | null
}

export type SalesPlan = {
  /** Already recorded, or a listing FlipLedger tracks (its own sale check handles that one). */
  skip: MarketplaceSale[]
  create: MarketplaceSale[]
}

/**
 * Decide which sales found on a marketplace become new sold items. Tracked listings are
 * left to applySaleChecks so a sale is never counted twice; `recorded` are external IDs
 * already in marketplace_sales.
 */
export function planUntrackedSales(
  sales: MarketplaceSale[],
  existing: { listings: { marketplace: string; external_url: string | null }[]; recorded: string[] },
): SalesPlan {
  const tracked = new Set(existing.listings.map((l) => listingKey(l.marketplace, l.external_url)).filter(Boolean))
  const recorded = new Set(existing.recorded)
  const seen = new Set<string>()
  const plan: SalesPlan = { skip: [], create: [] }
  for (const s of sales) {
    if (seen.has(s.externalId)) continue
    seen.add(s.externalId)
    if (recorded.has(s.externalId) || tracked.has(`${s.marketplace}:${s.externalId}`)) plan.skip.push(s)
    else plan.create.push(s)
  }
  return plan
}

/** A sold item for a Mercari sale: one unit at the page price, fee from Mercari's preset. */
export function marketplaceSoldItem(s: MarketplaceSale, userId: string, now = new Date()): SoldItemRow {
  const fee = presetFor(marketplace(s.marketplace).feePreset)
  const parsed = s.soldAt ? new Date(s.soldAt) : null
  // A date in the future or before Mercari existed means we misread the page.
  const soldAt = parsed && parsed.getTime() <= now.getTime() && parsed.getUTCFullYear() >= 2013 ? parsed : now
  return {
    user_id: userId,
    title: s.title,
    status: "sold",
    quantity: 1,
    cost_cents: 0,
    cost_unknown: true,
    purchased_at: soldAt.toISOString(),
    link_url: s.url,
    sale_price_cents: s.priceCents ?? 0,
    buyer_shipping_cents: 0,
    label_cost_cents: 0,
    fee_pct: fee.pct,
    fee_fixed_cents: fee.fixedCents,
    platform: fee.id,
    sold_at: soldAt.toISOString(),
  }
}
