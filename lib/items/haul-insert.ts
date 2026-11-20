import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { distributeHaul } from "@/lib/profit"

export type HaulRows = {
  title: string | null
  store: string | null
  totalCents: number
  /** ISO timestamp. */
  purchasedAt: string
  returnable: boolean
  returnDeadline: string | null
  splitMode: "even" | "value"
  receiptPath: string | null
  lines: { title: string; quantity: number; estValueCents: number }[]
}

/**
 * Inserts a lot and one inventory item per line, its total split across the units (by estimated
 * value, or evenly). Shared by "Log a lot" and receiving an incoming order. Returns the lot's id.
 */
export async function insertHaul(supabase: SupabaseClient, h: HaulRows): Promise<string> {
  const { data: haul, error } = await supabase
    .from("hauls")
    .insert({
      title: h.title,
      store: h.store,
      total_cents: h.totalCents,
      purchased_at: h.purchasedAt,
      split_mode: h.splitMode,
      receipt_path: h.receiptPath,
    })
    .select("id")
    .single()
  if (error) throw error

  // Even split ignores the estimated values: same cost for every unit.
  const split = distributeHaul(
    h.totalCents,
    h.splitMode === "even" ? h.lines.map((l) => ({ ...l, estValueCents: 0 })) : h.lines,
  )
  // Insert one at a time so the seq trigger numbers them in order.
  for (const [idx, line] of h.lines.entries()) {
    const { error: insErr } = await supabase.from("items").insert({
      title: line.title,
      store: h.store,
      quantity: line.quantity,
      cost_cents: split[idx].unitCostCents,
      purchased_at: h.purchasedAt,
      haul_id: haul.id,
      status: "inventory",
      returnable: h.returnable,
      return_deadline: h.returnable ? h.returnDeadline : null,
    })
    if (insErr) throw insErr
  }
  return haul.id as string
}
