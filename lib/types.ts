import type { ItemCondition, MarketplaceId } from "./marketplaces/registry"

export type ItemStatus = "inventory" | "sold" | "returned"
export type Platform = "cash" | "card" | "mercari_depop" | "ebay" | "poshmark_amz" | "custom"

export type Item = {
  id: string
  seq: number
  title: string | null
  status: ItemStatus
  quantity: number
  cost_cents: number
  /** Imported from a marketplace: the seller hasn't entered what they paid yet. */
  cost_unknown: boolean
  purchased_at: string
  store: string | null
  link_url: string | null
  haul_id: string | null
  sale_price_cents: number | null
  buyer_shipping_cents: number
  label_cost_cents: number
  fee_pct: number
  fee_fixed_cents: number
  platform: Platform | null
  sold_at: string | null
  returnable: boolean
  return_deadline: string | null
  photo_paths: string[]
  /** Signed URLs matching photo_paths (filled in by getItems). */
  photo_urls: string[]
  description: string | null
  condition: ItemCondition | null
  brand: string | null
  size: string | null
  list_price_cents: number | null
  /** Cross-listings for this item (filled in by getItems). */
  listings: Listing[]
  created_at: string
}

export type ListingStatus = "draft" | "active" | "delist_pending" | "delisted" | "sold" | "error"

export type Listing = {
  id: string
  user_id: string
  item_id: string
  marketplace: MarketplaceId
  status: ListingStatus
  external_id: string | null
  offer_id: string | null
  external_url: string | null
  price_cents: number | null
  last_error: string | null
  listed_at: string | null
  delisted_at: string | null
  /** eBay Promoted Listings ad rate in percent; null when not promoted. */
  ad_rate: number | null
  /** Edit once, update everywhere: whether the site has FlipLedger's latest title/price/quantity. */
  sync_status: "synced" | "pending" | "failed"
  sync_error: string | null
  /** Changes still to make on the site (pending/failed). */
  pending_changes: { priceCents?: number; quantity?: number; title?: string; description?: string } | null
}

export type MarketplaceConnection = {
  id: string
  marketplace: MarketplaceId
  external_username: string | null
  settings: EbaySettings
  last_synced_at: string | null
  scopes: string[] | null
}

export type EbayPolicy = { id: string; name: string }
export type EbaySettings = {
  fulfillmentPolicyId?: string
  paymentPolicyId?: string
  returnPolicyId?: string
  merchantLocationKey?: string
  postalCode?: string
  policies?: { fulfillment: EbayPolicy[]; payment: EbayPolicy[]; return: EbayPolicy[] }
  setupError?: string
  /** Promote new eBay listings by default (Promoted Listings, cost per sale) at this ad rate. */
  promote?: { enabled: boolean; rate: number }
  /** The seller's "FlipLedger promoted listings" campaign. */
  campaignId?: string
}

export type Expense = {
  id: string
  kind: "expense" | "mileage"
  title: string
  category: string
  amount_cents: number
  spent_at: string
  miles: number | null
  rate_cents: number | null
  start_location: string | null
  end_location: string | null
}

export type Subscription = {
  id: string
  name: string
  amount_cents: number
  active: boolean
  started_at: string
}

export type Settings = {
  mileage_rate_cents: number
  default_return_days: number
  /** Estimated federal bracket as a fraction, e.g. 0.22. */
  tax_bracket: number
  /** False until the seller picks a bracket (we default to 22%). */
  tax_bracket_set: boolean
  /** Days before an unsold item counts as stale (30/45/60/90/120). */
  stale_days: number
  /** Sunday profit recap email. */
  email_recap: boolean
  /** Quarterly estimated tax reminder emails. */
  email_tax_reminders: boolean
}

export const EXPENSE_CATEGORIES = [
  "Packaging",
  "Shipping Supplies",
  "Software",
  "Platform Fees",
  "Storage",
  "Equipment",
  "Travel",
  "Meals",
  "Other",
] as const

export const DRIVE_PURPOSES = [
  "Garage Sale & Yard Sale Sourcing",
  "Thrift Store Sourcing",
  "Retail Arbitrage",
  "Post Office / Drop-off",
  "Supply Run",
  "Other Business Trip",
] as const
