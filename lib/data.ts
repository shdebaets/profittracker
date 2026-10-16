import "server-only"
import { requireUser } from "@/lib/supabase/server"
import type { Expense, Item, Settings, Subscription } from "@/lib/types"

export const DEFAULT_SETTINGS: Settings = { mileage_rate_cents: 76, default_return_days: 90 }

export async function getItems(): Promise<Item[]> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase.from("items").select("*").order("seq", { ascending: false })
  if (error) throw error
  return data as Item[]
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
