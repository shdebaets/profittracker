import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { recordSale } from "@/lib/crosslist/engine"
import { adapters, supabaseStore } from "@/lib/crosslist/store"
import { fetchOrders, fetchOrdersByIds } from "./adapter"
import { adFeeCents, ordersToSales, type EbaySaleLine } from "./mapping"
import { getUserToken } from "./oauth"
import { ebaySoldItem, isItemId } from "@/lib/sales/untracked"

const OVERLAP_MS = 15 * 60_000

/**
 * Pull new eBay orders for one user and turn each line into a sale. A line for one of
 * the user's items sells it (ending its other listings); any other line (listed straight
 * on eBay) becomes a new sold item with an unknown cost. Idempotent: processed lines are
 * recorded in marketplace_sales (claimed before processing so concurrent syncs can't
 * double-count). Runs on the admin client, so every query is scoped to userId.
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
    const { data: item } = isItemId(line.sku)
      ? await admin.from("items").select("id, user_id, status").eq("id", line.sku).eq("user_id", userId).maybeSingle()
      : { data: null }
    if (!item) {
      if (await recordUntrackedLine(admin, userId, line)) sales++
      continue
    }

    const { error: claimErr } = await admin.from("marketplace_sales").insert({
      marketplace: "ebay",
      external_line_id: line.lineItemId,
      ...saleDetails(line),
      user_id: userId,
      item_id: item.id,
    })
    if (claimErr) continue // already processed (unique violation)

    if (item.status !== "inventory") continue // user already marked it sold by hand
    try {
      // eBay's order fee doesn't include Promoted Listings, so add our estimate for promoted listings.
      const { data: listing } = await admin
        .from("marketplace_listings")
        .select("ad_rate")
        .eq("item_id", item.id)
        .eq("marketplace", "ebay")
        .maybeSingle()
      const adFee = adFeeCents(listing?.ad_rate == null ? null : Number(listing.ad_rate), line)
      const outcome = await recordSale(supabaseStore(admin), adapters, {
        itemId: item.id,
        qty: line.quantity,
        soldOn: "ebay",
        sale: {
          sale_price_cents: line.salePriceCents,
          buyer_shipping_cents: line.buyerShippingCents,
          label_cost_cents: 0,
          fee_pct: 0,
          fee_fixed_cents: line.feeCents + adFee,
          platform: "ebay",
          sold_at: new Date(line.soldAt).toISOString(),
        },
      })
      // A partial sale made a new sold row; point the sale at it so Orders shows the buyer.
      if (outcome.soldItemId && outcome.soldItemId !== item.id) {
        await admin
          .from("marketplace_sales")
          .update({ item_id: outcome.soldItemId })
          .eq("marketplace", "ebay")
          .eq("external_line_id", line.lineItemId)
          .eq("user_id", userId)
      }
      sales++
    } catch (e) {
      // Release the claim so the next sync retries this line.
      await admin.from("marketplace_sales").delete().eq("marketplace", "ebay").eq("external_line_id", line.lineItemId).eq("user_id", userId)
      console.error("eBay sale sync failed", line, e)
    }
  }

  try {
    await refreshShipping(admin, userId, token)
  } catch (e) {
    console.error("eBay shipping refresh failed", e)
  }

  await admin.from("marketplace_accounts").update({ last_synced_at: startedAt.toISOString() }).eq("id", account.id)
  return { sales }
}

/** A sale of something not listed through FlipLedger: a new sold item, cost to be added. */
async function recordUntrackedLine(admin: SupabaseClient, userId: string, line: EbaySaleLine) {
  const { error: claimErr } = await admin.from("marketplace_sales").insert({
    marketplace: "ebay",
    external_line_id: line.lineItemId,
    ...saleDetails(line),
    user_id: userId,
    item_id: null,
  })
  if (claimErr) return false // already processed (unique violation)
  try {
    const { data: created, error } = await admin.from("items").insert(ebaySoldItem(line, userId)).select("id").single()
    if (error) throw error
    await admin
      .from("marketplace_sales")
      .update({ item_id: created.id })
      .eq("marketplace", "ebay")
      .eq("external_line_id", line.lineItemId)
      .eq("user_id", userId)
    return true
  } catch (e) {
    await admin.from("marketplace_sales").delete().eq("marketplace", "ebay").eq("external_line_id", line.lineItemId).eq("user_id", userId)
    console.error("eBay sale sync failed (untracked item)", line, e)
    return false
  }
}

const saleDetails = (line: EbaySaleLine) => ({
  external_order_id: line.orderId,
  buyer: line.buyer,
  ship_by: line.shipBy,
  order_status: line.fulfillment,
})

const SHIPPING_WINDOW_MS = 60 * 24 * 60 * 60_000

/**
 * Orders only come back from fetchOrders once (by creation date), so recent eBay sales that
 * haven't shipped are re-read by ID. When eBay says FULFILLED, the item counts as shipped.
 */
async function refreshShipping(admin: SupabaseClient, userId: string, token: string) {
  const { data, error } = await admin
    .from("marketplace_sales")
    .select("external_order_id, item_id, items!inner(shipped_at)")
    .eq("marketplace", "ebay")
    .eq("user_id", userId)
    .not("external_order_id", "is", null)
    .gte("created_at", new Date(Date.now() - SHIPPING_WINDOW_MS).toISOString())
    .is("items.shipped_at", null)
    .limit(200)
  if (error) throw error
  const open = (data ?? []) as { external_order_id: string; item_id: string }[]
  if (!open.length) return

  const orders = await fetchOrdersByIds(token, [...new Set(open.map((r) => r.external_order_id))])
  for (const o of orders) {
    if (!o.orderFulfillmentStatus) continue
    await admin
      .from("marketplace_sales")
      .update({ order_status: o.orderFulfillmentStatus })
      .eq("marketplace", "ebay")
      .eq("user_id", userId)
      .eq("external_order_id", o.orderId)
    if (o.orderFulfillmentStatus !== "FULFILLED") continue
    const itemIds = open.filter((r) => r.external_order_id === o.orderId).map((r) => r.item_id)
    await admin.from("items").update({ shipped_at: new Date().toISOString() }).in("id", itemIds).eq("user_id", userId).is("shipped_at", null)
  }
}
