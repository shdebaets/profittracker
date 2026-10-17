import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { recordSale } from "@/lib/crosslist/engine"
import { adapters, supabaseStore } from "@/lib/crosslist/store"
import { fetchOrders } from "./adapter"
import { ordersToSales } from "./mapping"
import { getUserToken } from "./oauth"

const OVERLAP_MS = 15 * 60_000

/**
 * Pull new eBay orders for one user and turn each line into a sale, which ends
 * the item's other listings. Idempotent: processed lines are recorded in
 * marketplace_sales (claimed before processing so concurrent syncs can't double-sell).
 */
export async function syncEbaySales(admin: SupabaseClient, userId: string) {
  const auth = await getUserToken(userId, admin)
  if (!auth) return { sales: 0 }
  const { token, account } = auth
  const startedAt = new Date()
  const since = new Date(new Date(account.last_synced_at ?? account.created_at).getTime() - OVERLAP_MS)

  const lines = ordersToSales(await fetchOrders(token, since))
  let sales = 0
  for (const line of lines) {
    const { data: item } = await admin.from("items").select("id, user_id, status").eq("id", line.itemId).maybeSingle()
    if (!item || item.user_id !== userId) continue // not listed through FlipLedger

    const { error: claimErr } = await admin.from("marketplace_sales").insert({
      marketplace: "ebay",
      external_line_id: line.lineItemId,
      external_order_id: line.orderId,
      user_id: userId,
      item_id: item.id,
    })
    if (claimErr) continue // already processed (unique violation)

    if (item.status !== "inventory") continue // user already marked it sold by hand
    try {
      await recordSale(supabaseStore(admin), adapters, {
        itemId: item.id,
        qty: line.quantity,
        soldOn: "ebay",
        sale: {
          sale_price_cents: line.salePriceCents,
          buyer_shipping_cents: line.buyerShippingCents,
          label_cost_cents: 0,
          fee_pct: 0,
          fee_fixed_cents: line.feeCents,
          platform: "ebay",
          sold_at: new Date(line.soldAt).toISOString(),
        },
      })
      sales++
    } catch (e) {
      // Release the claim so the next sync retries this line.
      await admin.from("marketplace_sales").delete().eq("marketplace", "ebay").eq("external_line_id", line.lineItemId)
      console.error("eBay sale sync failed", line, e)
    }
  }

  await admin.from("marketplace_accounts").update({ last_synced_at: startedAt.toISOString() }).eq("id", account.id)
  return { sales }
}
