// Edit once, update everywhere. After an item's title, description, price or quantity changes,
// push it to every live listing: eBay is revised in place through the API (keeps watchers and
// search rank); assisted sites (no API) are marked `pending` with the changes to make, which the
// extension or the seller applies on that site's edit page.
import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { friendlyError } from "@/lib/errors"
import { reviseEbayListing, type ListingChanges } from "@/lib/marketplaces/ebay/revise"
import type { Listing } from "@/lib/types"

export type { ListingChanges }

/** Merge new changes into what's still waiting for a site. Pure. */
export function mergeChanges(pending: ListingChanges | null | undefined, next: ListingChanges): ListingChanges {
  return { ...(pending ?? {}), ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) }
}

export function hasChanges(c: ListingChanges) {
  return Object.values(c).some((v) => v !== undefined)
}

export type SyncOutcome = { marketplace: string; status: "synced" | "pending" | "failed"; error?: string }

/** Push changes to the item's live listings. `supabase` is the user's client (RLS). */
export async function propagateToListings(
  supabase: SupabaseClient,
  itemId: string,
  changes: ListingChanges,
  opts: { canUseApi: boolean },
): Promise<SyncOutcome[]> {
  if (!hasChanges(changes)) return []
  const { data, error } = await supabase
    .from("marketplace_listings")
    .select("*")
    .eq("item_id", itemId)
    .eq("status", "active")
  if (error) throw error
  const out: SyncOutcome[] = []
  for (const l of (data ?? []) as Listing[]) {
    const pending = mergeChanges(l.pending_changes, changes)
    const price = changes.priceCents !== undefined ? { price_cents: changes.priceCents } : {}
    if (l.marketplace === "ebay" && opts.canUseApi) {
      try {
        await reviseEbayListing(l, pending)
        await supabase.from("marketplace_listings").update({ ...price, sync_status: "synced", sync_error: null, pending_changes: null }).eq("id", l.id)
        out.push({ marketplace: l.marketplace, status: "synced" })
      } catch (e) {
        const msg = friendlyError(e)
        console.error("[edit everywhere] eBay revise failed", e)
        await supabase.from("marketplace_listings").update({ sync_status: "failed", sync_error: msg, pending_changes: pending }).eq("id", l.id)
        out.push({ marketplace: l.marketplace, status: "failed", error: msg })
      }
    } else {
      await supabase.from("marketplace_listings").update({ ...price, sync_status: "pending", sync_error: null, pending_changes: pending }).eq("id", l.id)
      out.push({ marketplace: l.marketplace, status: "pending" })
    }
  }
  return out
}
