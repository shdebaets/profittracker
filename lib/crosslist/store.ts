import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { sellItem } from "@/lib/items/sell"
import { ebayAdapter } from "@/lib/marketplaces/ebay/adapter"
import type { Listing } from "@/lib/types"
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
