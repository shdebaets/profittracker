// Edit a live eBay listing in place (keeps watchers and search rank): price and quantity through
// bulk_update_price_quantity, title and description by rewriting the inventory item (and the
// offer's description). eBay revises published listings when these change.
import "server-only"
import { APP_URL } from "@/lib/email/send"
import { photoLink } from "@/lib/photo-links"
import type { Listing } from "@/lib/types"
import { EbayError, ebayFetch } from "./client"
import { ebayTitle, toEbayMoney } from "./mapping"
import { requireUserToken } from "./oauth"

export type ListingChanges = { priceCents?: number; quantity?: number; title?: string; description?: string; photoPaths?: string[] }

type InventoryItem = { product?: { title?: string; description?: string; [k: string]: unknown }; [k: string]: unknown }
type Offer = { listingDescription?: string; [k: string]: unknown }

export async function reviseEbayListing(listing: Listing, c: ListingChanges) {
  const { token } = await requireUserToken(listing.user_id)
  const sku = listing.item_id

  if (c.priceCents !== undefined || c.quantity !== undefined) {
    const res = await ebayFetch<{ responses?: { statusCode?: number; errors?: { message?: string; longMessage?: string }[] }[] }>(token, "/sell/inventory/v1/bulk_update_price_quantity", {
      body: {
        requests: [
          {
            sku,
            ...(c.quantity !== undefined ? { shipToLocationAvailability: { quantity: c.quantity } } : {}),
            offers: listing.offer_id
              ? [
                  {
                    offerId: listing.offer_id,
                    ...(c.quantity !== undefined ? { availableQuantity: c.quantity } : {}),
                    ...(c.priceCents !== undefined ? { price: toEbayMoney(c.priceCents) } : {}),
                  },
                ]
              : [],
          },
        ],
      },
    })
    // This call answers 200 even when a line fails; the real result is per line.
    const bad = res.responses?.find((r) => (r.statusCode ?? 200) >= 400 || r.errors?.length)
    if (bad) {
      const e = bad.errors?.[0]
      throw new EbayError(e?.longMessage || e?.message || "eBay didn't accept the change", bad.statusCode ?? 400, bad.errors ?? [])
    }
  }

  if (c.title !== undefined || c.description !== undefined || c.photoPaths?.length) {
    const path = `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`
    const current = await ebayFetch<InventoryItem>(token, path)
    const product = { ...(current.product ?? {}) }
    if (c.title !== undefined) product.title = ebayTitle(c.title)
    if (c.description !== undefined) product.description = c.description
    // Short signed links: eBay rejects picture URLs over 500 characters.
    if (c.photoPaths?.length) product.imageUrls = c.photoPaths.slice(0, 24).map((path) => photoLink(APP_URL, path))
    // Read-only fields eBay returns but rejects on write.
    const { sku: _sku, locale: _locale, groupIds: _g, inventoryItemGroupKeys: _k, ...rest } = current as Record<string, unknown>
    void _sku; void _locale; void _g; void _k
    await ebayFetch(token, path, { method: "PUT", body: { ...rest, product } })

    if (c.description !== undefined && listing.offer_id) {
      const offerPath = `/sell/inventory/v1/offer/${encodeURIComponent(listing.offer_id)}`
      const offer = await ebayFetch<Offer>(token, offerPath)
      const { offerId: _o, status: _s, listing: _l, ...writable } = offer as Record<string, unknown>
      void _o; void _s; void _l
      await ebayFetch(token, offerPath, { method: "PUT", body: { ...writable, listingDescription: c.description } })
    }
  }
}
