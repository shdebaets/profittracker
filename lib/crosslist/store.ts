import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { sellItem } from "@/lib/items/sell"
import { ebayAdapter } from "@/lib/marketplaces/ebay/adapter"
import type { ItemStatus, Listing } from "@/lib/types"
import type { SaleCheckStore } from "./assisted-sales"
import type { Adapters, CrosslistStore } from "./engine"

export const adapters: Adapters = { ebay: ebayAdapter }

export function supabaseStore(db: SupabaseClient): CrosslistStore {
  return {
    sell: (itemId, qty, sale) => sellItem(db, itemId, qty, sale),
    async listings(itemId) {
      const { data, error } = await db.from("marketplace_listings").select("*").eq("item_id", itemId)
      if (error) throw error
      return data as Listing[]
    },
    async updateListing(id, patch) {
      const { error } = await db.from("marketplace_listings").update(patch).eq("id", id)
      if (error) throw error
    },
  }
}

/**
 * Store for applySaleChecks. `db` is a user client (RLS) or the admin client (cron). Only the
 * service role can write marketplace_sales; claims use the owner of a listing `db` could read.
 */
export function saleCheckStore(db: SupabaseClient, admin: SupabaseClient): SaleCheckStore {
  return {
    ...supabaseStore(db),
    async listing(id) {
      const { data, error } = await db.from("marketplace_listings").select("*").eq("id", id).maybeSingle()
      if (error) throw error
      return data as Listing | null
    },
    async itemStatus(itemId) {
      const { data } = await db.from("items").select("status").eq("id", itemId).maybeSingle()
      return (data?.status as ItemStatus | undefined) ?? null
    },
    async claimSale(l) {
      const { error } = await admin
        .from("marketplace_sales")
        .insert({ marketplace: l.marketplace, external_line_id: l.id, user_id: l.user_id, item_id: l.item_id })
      return !error
    },
    async releaseSale(l) {
      await admin.from("marketplace_sales").delete().eq("marketplace", l.marketplace).eq("external_line_id", l.id).eq("user_id", l.user_id)
    },
  }
}
