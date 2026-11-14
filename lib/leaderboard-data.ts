import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { monthRange, monthTotals, type Month, type MonthTotals } from "./leaderboard"

export type BoardRow = { userId: string; name: string; totals: MonthTotals }

/** Totals for one seller's month. Works with their own client (RLS) or the admin client. */
export async function sellerMonth(supabase: SupabaseClient, userId: string, m: Month): Promise<MonthTotals> {
  const { from, to } = monthRange(m)
  const [items, trips] = await Promise.all([
    supabase
      .from("items")
      .select("status, sold_at, quantity, sale_price_cents, buyer_shipping_cents, label_cost_cents, fee_pct, fee_fixed_cents, cost_cents")
      .eq("user_id", userId)
      .eq("status", "sold")
      .gte("sold_at", from.toISOString())
      .lt("sold_at", to.toISOString()),
    supabase
      .from("expenses")
      .select("kind, spent_at, miles")
      .eq("user_id", userId)
      .eq("kind", "mileage")
      .gte("spent_at", from.toISOString())
      .lt("spent_at", to.toISOString()),
  ])
  return monthTotals(items.data ?? [], trips.data ?? [], m)
}

/** Every opted-in seller's month. Admin client: only names and totals leave this function. */
export async function boardRows(admin: SupabaseClient, m: Month): Promise<BoardRow[]> {
  const { data } = await admin.from("leaderboard_profiles").select("user_id, display_name").eq("opted_in", true).limit(500)
  return Promise.all((data ?? []).map(async (p) => ({ userId: p.user_id, name: p.display_name, totals: await sellerMonth(admin, p.user_id, m) })))
}
