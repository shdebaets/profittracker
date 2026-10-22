import "server-only"
import { signPaths } from "@/lib/photos"
import { requireUser } from "@/lib/supabase/server"
import type { Expense, Item, MarketplaceConnection, Settings, Subscription } from "@/lib/types"

export const DEFAULT_SETTINGS: Settings = { mileage_rate_cents: 76, default_return_days: 90 }

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
  const { data } = await supabase.from("settings").select("mileage_rate_cents, default_return_days").maybeSingle()
  return (data as Settings | null) ?? DEFAULT_SETTINGS
}
