// Turn the Chrome extension's listing-page checks (Poshmark, Mercari) into sales and
// confirmed takedowns. Pure: persistence comes in through the store, like ./engine.ts.
import { reportError } from "@/lib/errors"
import { marketplace, type MarketplaceId } from "@/lib/marketplaces/registry"
import { presetFor } from "@/lib/profit"
import type { ItemStatus, Listing } from "@/lib/types"
import { recordSale, type Adapters, type CrosslistStore } from "./engine"

export type SaleCheck = {
  listingId: string
  state: "sold" | "available" | "unavailable" | "unknown"
  priceCents: number | null
}

export type SaleCheckStore = CrosslistStore & {
  listing(id: string): Promise<Listing | null>
  itemStatus(itemId: string): Promise<ItemStatus | null>
  /** Record that this listing's sale was processed. False if it already was. */
  claimSale(listing: Listing): Promise<boolean>
  releaseSale(listing: Listing): Promise<void>
}

export type SaleCheckOutcome = { sales: MarketplaceId[]; delisted: number }

export async function applySaleChecks(
  store: SaleCheckStore,
  adapters: Adapters,
  checks: SaleCheck[],
  now = new Date(),
): Promise<SaleCheckOutcome> {
  const out: SaleCheckOutcome = { sales: [], delisted: 0 }
  for (const c of checks) {
    const l = await store.listing(c.listingId)
    if (!l || !marketplace(l.marketplace).saleCheck) continue

    // We asked the seller to take it down, and it's gone: no need for them to tap "Done".
    if (l.status === "delist_pending" && (c.state === "sold" || c.state === "unavailable")) {
      await store.updateListing(l.id, { status: "delisted", delisted_at: now.toISOString(), last_error: null })
      out.delisted++
      continue
    }

    if (l.status !== "active" || c.state !== "sold") continue
    if (!(await store.claimSale(l))) continue // already recorded
    if ((await store.itemStatus(l.item_id)) !== "inventory") continue // seller already marked it sold by hand

    const fee = presetFor(marketplace(l.marketplace).feePreset)
    try {
      // These sites sell one unit per listing, so one sale ends this listing even if units remain.
      await recordSale(store, adapters, {
        itemId: l.item_id,
        qty: 1,
        soldOn: l.marketplace,
        now,
        sale: {
          sale_price_cents: c.priceCents ?? l.price_cents ?? 0,
          buyer_shipping_cents: 0,
          label_cost_cents: 0,
          fee_pct: fee.pct,
          fee_fixed_cents: fee.fixedCents,
          platform: fee.id,
          sold_at: now.toISOString(),
        },
      })
      await store.updateListing(l.id, { status: "sold" })
      out.sales.push(l.marketplace)
    } catch (e) {
      // Release the claim so the next check retries.
      await store.releaseSale(l)
      reportError(e, `record ${l.marketplace} sale`)
    }
  }
  return out
}
