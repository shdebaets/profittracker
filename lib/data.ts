import "server-only"
import type { IncomingOrder } from "@/lib/incoming"
import type { Order } from "@/lib/orders"
import { signPaths } from "@/lib/photos"
import type { Haul } from "@/lib/lots"
import type { TaxPlatform } from "@/lib/tax"
import { requireUser } from "@/lib/supabase/server"
import type { CancelledSale, Expense, Item, MarketplaceConnection, Settings, Subscription } from "@/lib/types"

import { DEFAULT_SETTINGS } from "@/lib/data-defaults"

export { DEFAULT_SETTINGS }

export async function getItems(): Promise<Item[]> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase
    .from("items")
    .select("*, listings:marketplace_listings(*)")
    .order("seq", { ascending: false })
  if (error) throw error
  const rows = data as Omit<Item, "photo_urls">[]
  const urls = await signPaths(supabase, rows.flatMap((r) => r.photo_paths ?? []))
  return rows.map((r) => ({ ...r, photo_urls: (r.photo_paths ?? []).map((p) => urls.get(p) ?? "") }))
}

/** Sold items with what each marketplace said about the sale, newest first. Signs only the cover photo. */
export async function getOrders(): Promise<Order[]> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase
    .from("items")
    .select("*, listings:marketplace_listings(*), sales:marketplace_sales(marketplace, external_order_id, buyer, ship_by, order_status)")
    .eq("status", "sold")
    .order("sold_at", { ascending: false })
    .limit(500)
  if (error) throw error
  const rows = data as Omit<Order, "photo_urls">[]
  const urls = await signPaths(supabase, rows.flatMap((r) => r.photo_paths?.slice(0, 1) ?? []))
  return rows.map((r) => ({ ...r, photo_urls: (r.photo_paths ?? []).slice(0, 1).map((p) => urls.get(p) ?? "") }))
}

/** How many online orders are still on their way (not received, not cancelled), for the dashboard. */
export async function countIncomingOnTheWay(): Promise<number> {
  const { supabase } = await requireUser()
  const { count, error } = await supabase
    .from("incoming_orders")
    .select("id", { count: "exact", head: true })
    .is("received_at", null)
    .neq("status", "cancelled")
  if (error) throw error
  return count ?? 0
}

/** Online purchases on their way in (Orders → Buying), newest first. */
export async function getIncoming(): Promise<IncomingOrder[]> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase.from("incoming_orders").select("*").order("ordered_at", { ascending: false }).limit(500)
  if (error) throw error
  return data as IncomingOrder[]
}

export async function getItem(id: string): Promise<Item | null> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase
    .from("items")
    .select("*, listings:marketplace_listings(*)")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as Omit<Item, "photo_urls">
  const urls = await signPaths(supabase, row.photo_paths ?? [])
  return { ...row, photo_urls: (row.photo_paths ?? []).map((p) => urls.get(p) ?? "") }
}

export async function getConnections(): Promise<MarketplaceConnection[]> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase.from("marketplace_connections").select("*")
  if (error) throw error
  return data as MarketplaceConnection[]
}

export async function getExpenses(): Promise<Expense[]> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase.from("expenses").select("*").order("spent_at", { ascending: false })
  if (error) throw error
  return data as Expense[]
}

export async function getSubscriptions(): Promise<Subscription[]> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase.from("subscriptions").select("*").order("created_at")
  if (error) throw error
  return data as Subscription[]
}

export async function getSettings(): Promise<Settings> {
  const { supabase } = await requireUser()
  const { data } = await supabase
    .from("settings")
    .select("mileage_rate_cents, default_return_days, tax_bracket, tax_bracket_set, tax_filing_status, tax_income_cents, stale_days, email_recap, email_tax_reminders, push_recap, push_tax_reminders, email_alerts, email_returns, push_returns")
    .maybeSingle()
  const row = data as Settings | null
  return row ? { ...row, tax_bracket: Number(row.tax_bracket), tax_income_cents: row.tax_income_cents == null ? null : Number(row.tax_income_cents) } : DEFAULT_SETTINGS
}

/** 1099-K gross the seller typed in per platform for a tax year. */
export async function getTaxForms(year: number): Promise<Partial<Record<TaxPlatform, number>>> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase.from("tax_forms").select("platform, gross_cents").eq("tax_year", year)
  if (error) throw error
  return Object.fromEntries((data ?? []).map((r) => [r.platform, Number(r.gross_cents)]))
}

/** Cancelled sales the seller logged or eBay reported. Filtered to a tax year by the caller (local time). */
export async function getCancelledSales(): Promise<CancelledSale[]> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase
    .from("cancelled_sales")
    .select("id, platform, cancelled_at, gross_cents, title, external_id")
    .order("cancelled_at", { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => ({ ...r, gross_cents: Number(r.gross_cents) })) as CancelledSale[]
}

export async function getHauls(): Promise<Haul[]> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase.from("hauls").select("*").order("purchased_at", { ascending: false })
  if (error) throw error
  return data as Haul[]
}
