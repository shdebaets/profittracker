// The cross-listing rule: when an item sells anywhere, it comes down everywhere else.
// API marketplaces are ended for the user; assisted ones become a "delist this" to-do.
import { reportError } from "@/lib/errors"
import type { SaleColumns } from "@/lib/items/sell"
import { marketplace, type MarketplaceId } from "@/lib/marketplaces/registry"
import type { ApiAdapter } from "@/lib/marketplaces/types"
import type { Listing, ListingStatus } from "@/lib/types"

export type Adapters = Partial<Record<MarketplaceId, ApiAdapter>>

export type ListingPatch = Partial<Pick<Listing, "status" | "last_error" | "delisted_at">>

/** Persistence the engine needs; implemented over Supabase in ./store.ts and faked in tests. */
export type CrosslistStore = {
  sell(itemId: string, qty: number, sale: SaleColumns): Promise<{ remaining: number; soldItemId?: string }>
  listings(itemId: string): Promise<Listing[]>
  updateListing(id: string, patch: ListingPatch): Promise<void>
}

export type TakedownOutcome = {
  ended: MarketplaceId[]
  needsDelist: MarketplaceId[]
  failed: { marketplace: MarketplaceId; error: string }[]
}

/** soldItemId: the sold row (a new row when units remain, else the item itself). */
export type SaleOutcome = TakedownOutcome & { remaining: number; soldItemId?: string }

/** Listings that may still be live somewhere. "error" = an earlier end attempt failed. */
const LIVE: ListingStatus[] = ["active", "error"]

export async function takeDown(
  store: CrosslistStore,
  adapters: Adapters,
  itemId: string,
  opts: { except?: MarketplaceId | null; now?: Date } = {},
): Promise<TakedownOutcome> {
  const out: TakedownOutcome = { ended: [], needsDelist: [], failed: [] }
  const now = (opts.now ?? new Date()).toISOString()
  const live = (await store.listings(itemId)).filter((l) => LIVE.includes(l.status) && l.marketplace !== opts.except)

  await Promise.all(
    live.map(async (l) => {
      const adapter = marketplace(l.marketplace).mode === "api" ? adapters[l.marketplace] : undefined
      if (!adapter) {
        await store.updateListing(l.id, { status: "delist_pending" })
        out.needsDelist.push(l.marketplace)
        return
      }
      try {
        await adapter.end(l)
        await store.updateListing(l.id, { status: "delisted", delisted_at: now, last_error: null })
        out.ended.push(l.marketplace)
      } catch (e) {
        const error = reportError(e, `end ${l.marketplace} listing`)
        await store.updateListing(l.id, { status: "error", last_error: error })
        out.failed.push({ marketplace: l.marketplace, error })
      }
    }),
  )
  return out
}

/**
 * Record a sale of `qty` units and react across marketplaces:
 * - whole lot sold → end/flag every other live listing
 * - units left → only update the remaining quantity on API listings
 */
export async function recordSale(
  store: CrosslistStore,
  adapters: Adapters,
  e: { itemId: string; qty: number; sale: SaleColumns; soldOn?: MarketplaceId | null; now?: Date },
): Promise<SaleOutcome> {
  const { remaining, soldItemId } = await store.sell(e.itemId, e.qty, { ...e.sale, sold_on: e.soldOn ?? e.sale.sold_on ?? null })
  const listings = await store.listings(e.itemId)

  if (e.soldOn && remaining === 0) {
    const own = listings.find((l) => l.marketplace === e.soldOn)
    if (own) await store.updateListing(own.id, { status: "sold" })
  }

  if (remaining > 0) {
    const out: SaleOutcome = { remaining, soldItemId, ended: [], needsDelist: [], failed: [] }
    for (const l of listings) {
      // The marketplace it sold on already adjusted its own quantity.
      if (l.status !== "active" || l.marketplace === e.soldOn) continue
      const adapter = marketplace(l.marketplace).mode === "api" ? adapters[l.marketplace] : undefined
      if (!adapter) continue
      try {
        await adapter.setQuantity(l, remaining)
      } catch (err) {
        out.failed.push({ marketplace: l.marketplace, error: reportError(err, `update ${l.marketplace} quantity`) })
      }
    }
    return out
  }

  return { remaining, soldItemId, ...(await takeDown(store, adapters, e.itemId, { except: e.soldOn, now: e.now })) }
}
