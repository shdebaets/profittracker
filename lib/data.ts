import "server-only"
import type { Order } from "@/lib/orders"
import { signPaths } from "@/lib/photos"
import { DEFAULT_TAX_BRACKET, type TaxPlatform } from "@/lib/tax"
import { requireUser } from "@/lib/supabase/server"
import type { Expense, Item, MarketplaceConnection, Settings, Subscription } from "@/lib/types"

export const DEFAULT_SETTINGS: Settings = {
  mileage_rate_cents: 76,
  default_return_days: 90,
  tax_bracket: DEFAULT_TAX_BRACKET,
  tax_bracket_set: false,
}

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
    .select("mileage_rate_cents, default_return_days, tax_bracket, tax_bracket_set")
    .maybeSingle()
  const row = data as Settings | null
  return row ? { ...row, tax_bracket: Number(row.tax_bracket) } : DEFAULT_SETTINGS
}

/** 1099-K gross the seller typed in per platform for a tax year. */
export async function getTaxForms(year: number): Promise<Partial<Record<TaxPlatform, number>>> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase.from("tax_forms").select("platform, gross_cents").eq("tax_year", year)
  if (error) throw error
  return Object.fromEntries((data ?? []).map((r) => [r.platform, Number(r.gross_cents)]))
}
