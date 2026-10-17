import type { Platform } from "@/lib/types"

export type MarketplaceId = "ebay" | "mercari" | "facebook" | "depop" | "vinted" | "poshmark" | "etsy"

export type Marketplace = {
  id: MarketplaceId
  label: string
  short: string
  /** "api": we list and end listings for the user. "assisted": the user does it, we track it and nudge. */
  mode: "api" | "assisted"
  /** Where to create a listing. */
  sellUrl: string
  /** Where the user manages existing listings (fallback when no listing URL was saved). */
  manageUrl: string
  /** Fee preset used when a sale on this marketplace is recorded. */
  feePreset: Platform
  photoLimit: number
  /** Tailwind classes for the badge. */
  badge: string
}

export const MARKETPLACES: Marketplace[] = [
  {
    id: "ebay", label: "eBay", short: "eBay", mode: "api",
    sellUrl: "https://www.ebay.com/sl/sell", manageUrl: "https://www.ebay.com/sh/lst/active",
    feePreset: "ebay", photoLimit: 24, badge: "bg-blue-600 text-white",
  },
  {
    id: "mercari", label: "Mercari", short: "Mercari", mode: "assisted",
    sellUrl: "https://www.mercari.com/sell/", manageUrl: "https://www.mercari.com/mypage/listings/",
    feePreset: "mercari_depop", photoLimit: 12, badge: "bg-red-500 text-white",
  },
  {
    id: "facebook", label: "Facebook Marketplace", short: "Facebook", mode: "assisted",
    sellUrl: "https://www.facebook.com/marketplace/create/item", manageUrl: "https://www.facebook.com/marketplace/you/selling",
    feePreset: "cash", photoLimit: 10, badge: "bg-sky-600 text-white",
  },
  {
    id: "depop", label: "Depop", short: "Depop", mode: "assisted",
    sellUrl: "https://www.depop.com/products/create/", manageUrl: "https://www.depop.com/",
    feePreset: "mercari_depop", photoLimit: 4, badge: "bg-neutral-900 text-white",
  },
  {
    id: "vinted", label: "Vinted", short: "Vinted", mode: "assisted",
    sellUrl: "https://www.vinted.com/items/new", manageUrl: "https://www.vinted.com/",
    feePreset: "cash", photoLimit: 20, badge: "bg-teal-600 text-white",
  },
  {
    id: "poshmark", label: "Poshmark", short: "Posh", mode: "assisted",
    sellUrl: "https://poshmark.com/create-listing", manageUrl: "https://poshmark.com/",
    feePreset: "poshmark_amz", photoLimit: 16, badge: "bg-rose-800 text-white",
  },
]

export function marketplace(id: MarketplaceId): Marketplace {
  const m = MARKETPLACES.find((x) => x.id === id)
  if (!m) throw new Error(`Unknown marketplace ${id}`)
  return m
}

export const ITEM_CONDITIONS = [
  { value: "new_with_tags", label: "New with tags" },
  { value: "new", label: "New, no tags" },
  { value: "like_new", label: "Like new" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
] as const
export type ItemCondition = (typeof ITEM_CONDITIONS)[number]["value"]
