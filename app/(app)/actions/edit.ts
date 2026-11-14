"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { propagateToListings } from "@/lib/crosslist/edit"
import { UserError } from "@/lib/errors"
import { askingPrice, repriced } from "@/lib/stale"
import { canCrosslist, requireUser } from "@/lib/supabase/server"
import type { Item, Listing } from "@/lib/types"
import { fail, type ActionResult } from "./result"

const changeSchema = z.object({
  itemIds: z.array(z.uuid()).min(1).max(200),
  mode: z.enum(["percent", "amount", "set"]),
  /** percent: 1–90; amount and set: cents. */
  value: z.number().positive().max(100_000_000),
})

export type RepriceResult =
  | { ok: true; updated: number; skipped: number; synced: number; pending: number; failed: number }
  | { ok: false; error: string }

/** Bulk reprice: new list price on each item, pushed to every live listing. */
export async function repriceItems(input: z.input<typeof changeSchema>): Promise<RepriceResult> {
  try {
    const c = changeSchema.parse(input)
    if (c.mode === "percent" && c.value > 90) throw new UserError("Drop by 90% or less.")
    const { supabase } = await requireUser()
    const canUseApi = await canCrosslist()
    const { data, error } = await supabase
      .from("items")
      .select("*, listings:marketplace_listings(*)")
      .in("id", c.itemIds)
      .eq("status", "inventory")
    if (error) throw error
    let updated = 0, skipped = 0, synced = 0, pending = 0, failed = 0
    for (const item of (data ?? []) as Item[]) {
      const current = askingPrice(item)
      if (current == null && c.mode !== "set") {
        skipped++
        continue
      }
      const next = repriced(current ?? 0, c)
      const { error: upErr } = await supabase.from("items").update({ list_price_cents: next }).eq("id", item.id)
      if (upErr) throw upErr
      updated++
      for (const o of await propagateToListings(supabase, item.id, { priceCents: next }, { canUseApi })) {
        if (o.status === "synced") synced++
        else if (o.status === "pending") pending++
        else failed++
      }
    }
    revalidatePath("/", "layout")
    return { ok: true, updated, skipped, synced, pending, failed }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

/** Try a failed eBay update again (or re-push pending changes). */
export async function retryListingSync(listingId: string): Promise<ActionResult> {
  try {
    const id = z.uuid().parse(listingId)
    const { supabase } = await requireUser()
    const { data, error } = await supabase.from("marketplace_listings").select("*").eq("id", id).single()
    if (error) throw error
    const l = data as Listing
    const [out] = await propagateToListings(supabase, l.item_id, l.pending_changes ?? {}, { canUseApi: await canCrosslist() })
    revalidatePath("/", "layout")
    if (out?.status === "failed") throw new UserError(out.error ?? "eBay still didn't accept the change.")
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/** The seller (or the extension) made the pending changes on the site. */
export async function markListingSynced(listingId: string): Promise<ActionResult> {
  try {
    const id = z.uuid().parse(listingId)
    const { supabase } = await requireUser()
    const { error } = await supabase
      .from("marketplace_listings")
      .update({ sync_status: "synced", sync_error: null, pending_changes: null })
      .eq("id", id)
    if (error) throw error
    revalidatePath("/", "layout")
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
