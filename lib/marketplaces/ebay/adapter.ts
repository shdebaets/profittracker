import "server-only"
import { UserError } from "@/lib/errors"
import type { ApiAdapter } from "@/lib/marketplaces/types"
import type { Listing } from "@/lib/types"
import { EBAY_MARKETPLACE_ID, EbayError, ebayConfig, ebayFetch } from "./client"
import { EBAY_CONDITION, ebayTitle, setupGaps, toEbayMoney, type EbayOrder } from "./mapping"
import { requireUserToken } from "./oauth"

const CATEGORY_TREE = "0" // EBAY_US

export type PublishInput = {
  item: {
    id: string
    title: string | null
    description: string | null
    condition: keyof typeof EBAY_CONDITION | null
    brand: string | null
    size: string | null
  }
  quantity: number
  priceCents: number
  categoryId: string
  aspects: Record<string, string[]>
  imageUrls: string[]
}

export async function publishToEbay(userId: string, input: PublishInput) {
  const { token, account } = await requireUserToken(userId)
  const s = account.settings
  const gaps = setupGaps(s)
  if (gaps.length) throw new UserError(`Finish eBay setup in Settings → Marketplaces: add ${gaps.join(", ")}.`)
  if (!input.imageUrls.length) throw new UserError("eBay needs at least one photo. Edit the item to add one.")

  const sku = input.item.id
  const title = ebayTitle(input.item.title || "Item")
  const description = input.item.description?.trim() || title
  const aspects = { ...input.aspects }
  if (input.item.brand && !aspects.Brand) aspects.Brand = [input.item.brand]
  if (input.item.size && !aspects.Size) aspects.Size = [input.item.size]

  await ebayFetch(token, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
    method: "PUT",
    body: {
      availability: { shipToLocationAvailability: { quantity: input.quantity } },
      condition: EBAY_CONDITION[input.item.condition ?? "good"],
      product: { title, description, aspects, imageUrls: input.imageUrls.slice(0, 24) },
    },
  })

  const offer = {
    sku,
    marketplaceId: EBAY_MARKETPLACE_ID,
    format: "FIXED_PRICE",
    availableQuantity: input.quantity,
    categoryId: input.categoryId,
    listingDescription: description,
    merchantLocationKey: s.merchantLocationKey,
    pricingSummary: { price: toEbayMoney(input.priceCents) },
    listingPolicies: {
      fulfillmentPolicyId: s.fulfillmentPolicyId,
      paymentPolicyId: s.paymentPolicyId,
      returnPolicyId: s.returnPolicyId,
    },
  }

  let offerId: string
  try {
    offerId = (await ebayFetch<{ offerId: string }>(token, "/sell/inventory/v1/offer", { body: offer })).offerId
  } catch (e) {
    // 25002: an offer already exists for this SKU (e.g. relisting). Update it instead.
    if (!(e instanceof EbayError) || !e.has(25002)) throw e
    offerId = e.param("offerId") ?? (await findOfferId(token, sku))
    await ebayFetch(token, `/sell/inventory/v1/offer/${offerId}`, { method: "PUT", body: offer })
  }

  const { listingId } = await ebayFetch<{ listingId: string }>(token, `/sell/inventory/v1/offer/${offerId}/publish`, {
    method: "POST",
    body: {},
  })
  return { offerId, listingId, url: ebayConfig().listingUrl(listingId) }
}

async function findOfferId(token: string, sku: string) {
  const r = await ebayFetch<{ offers?: { offerId: string }[] }>(
    token,
    `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${EBAY_MARKETPLACE_ID}`,
  )
  const id = r.offers?.[0]?.offerId
  if (!id) throw new UserError("Couldn't find this item's existing eBay listing. Try listing it again.")
  return id
}

export const ebayAdapter: ApiAdapter = {
  async end(listing: Listing) {
    if (!listing.offer_id) return
    const { token } = await requireUserToken(listing.user_id)
    try {
      await ebayFetch(token, `/sell/inventory/v1/offer/${listing.offer_id}/withdraw`, { method: "POST", body: {} })
    } catch (e) {
      if (!(e instanceof EbayError) || e.status >= 500) throw e
      // Already ended or sold out on eBay: nothing left to take down.
      if (e.status === 404) return
      const offer = await ebayFetch<{ status?: string }>(token, `/sell/inventory/v1/offer/${listing.offer_id}`).catch(() => null)
      if (offer && offer.status !== "PUBLISHED") return
      throw e
    }
  },
  async setQuantity(listing: Listing, quantity: number) {
    const { token } = await requireUserToken(listing.user_id)
    await ebayFetch(token, "/sell/inventory/v1/bulk_update_price_quantity", {
      body: {
        requests: [
          {
            sku: listing.item_id,
            shipToLocationAvailability: { quantity },
            offers: listing.offer_id ? [{ offerId: listing.offer_id, availableQuantity: quantity }] : [],
          },
        ],
      },
    })
  },
}

export async function fetchOrders(token: string, since: Date): Promise<EbayOrder[]> {
  const orders: EbayOrder[] = []
  let path: string | null =
    `/sell/fulfillment/v1/order?limit=100&filter=${encodeURIComponent(`creationdate:[${since.toISOString()}..]`)}`
  while (path) {
    const page: { orders?: EbayOrder[]; next?: string } = await ebayFetch(token, path)
    orders.push(...(page.orders ?? []))
    path = page.next ? page.next.replace(/^https:\/\/[^/]+/, "") : null
  }
  return orders
}

export type CategorySuggestion = { id: string; name: string; path: string }

export async function suggestCategories(userId: string, q: string): Promise<CategorySuggestion[]> {
  const { token } = await requireUserToken(userId)
  const r = await ebayFetch<{
    categorySuggestions?: {
      category: { categoryId: string; categoryName: string }
      categoryTreeNodeAncestors?: { categoryName: string }[]
    }[]
  }>(token, `/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE}/get_category_suggestions?q=${encodeURIComponent(q)}`)
  return (r.categorySuggestions ?? []).slice(0, 8).map((s) => ({
    id: s.category.categoryId,
    name: s.category.categoryName,
    path: [...(s.categoryTreeNodeAncestors ?? [])].reverse().map((a) => a.categoryName).join(" › "),
  }))
}

export type Aspect = { name: string; required: boolean; multi: boolean; freeText: boolean; values: string[] }

/** Item specifics for a category; required ones must be filled before publishing. */
export async function categoryAspects(userId: string, categoryId: string): Promise<Aspect[]> {
  const { token } = await requireUserToken(userId)
  const r = await ebayFetch<{
    aspects?: {
      localizedAspectName: string
      aspectConstraint: { aspectRequired?: boolean; aspectMode?: string; itemToAspectCardinality?: string; aspectUsage?: string }
      aspectValues?: { localizedValue: string }[]
    }[]
  }>(
    token,
    `/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
  )
  return (r.aspects ?? [])
    .filter((a) => a.aspectConstraint.aspectRequired || a.aspectConstraint.aspectUsage === "RECOMMENDED")
    .slice(0, 15)
    .map((a) => ({
      name: a.localizedAspectName,
      required: !!a.aspectConstraint.aspectRequired,
      multi: a.aspectConstraint.itemToAspectCardinality === "MULTI",
      freeText: a.aspectConstraint.aspectMode !== "SELECTION_ONLY",
      values: (a.aspectValues ?? []).slice(0, 200).map((v) => v.localizedValue),
    }))
}
