import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { UserError } from "@/lib/errors"
import type { Platform } from "@/lib/types"

export type SaleColumns = {
  sale_price_cents: number
  buyer_shipping_cents: number
  label_cost_cents: number
  fee_pct: number
  fee_fixed_cents: number
  platform: Platform
  sold_at: string
}

/**
 * Sell `qty` units of an inventory lot. Selling the whole lot flips the row to
 * sold; a partial sale decrements the lot and inserts a new sold row.
 * Works with a user client (RLS) or the admin client (cron), so it always
 * scopes by the item's own user_id.
 */
export async function sellItem(
  supabase: SupabaseClient,
  id: string,
  qty: number,
  sale: SaleColumns,
): Promise<{ remaining: number; soldItemId: string }> {
  const { data: item, error: readErr } = await supabase.from("items").select("*").eq("id", id).single()
  if (readErr) throw readErr
  if (item.status !== "inventory") throw new UserError("This item isn't in your inventory any more. Refresh and try again.")
  if (qty > item.quantity) throw new UserError(`Only ${item.quantity} unit${item.quantity === 1 ? "" : "s"} left in stock.`)

  if (qty === item.quantity) {
    const { error } = await supabase.from("items").update({ status: "sold", ...sale }).eq("id", id)
    if (error) throw error
    return { remaining: 0, soldItemId: id }
  }

  const { data: dec, error: decErr } = await supabase
    .from("items")
    .update({ quantity: item.quantity - qty })
    .eq("id", id)
    .eq("quantity", item.quantity) // optimistic guard against double-submit
    .select("id")
  if (decErr) throw decErr
  if (!dec?.length) throw new UserError("This item just changed. Refresh and try again.")
  const { data: sold, error } = await supabase
    .from("items")
    .insert({
      user_id: item.user_id,
      title: item.title,
      store: item.store,
      link_url: item.link_url,
      photo_paths: item.photo_paths,
      description: item.description,
      condition: item.condition,
      brand: item.brand,
      size: item.size,
      haul_id: item.haul_id,
      cost_cents: item.cost_cents,
      purchased_at: item.purchased_at,
      returnable: false,
      quantity: qty,
      status: "sold",
      ...sale,
    })
    .select("id")
    .single()
  if (error) throw error
  return { remaining: item.quantity - qty, soldItemId: sold.id }
}
