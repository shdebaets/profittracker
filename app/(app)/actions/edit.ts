"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { propagateToListings } from "@/lib/crosslist/edit"
import { UserError } from "@/lib/errors"
import { planReprice, validChange } from "@/lib/reprice"
import { soldMedians } from "@/lib/sold-medians"
import { askingPrice } from "@/lib/stale"
import { canCrosslist, requireUser } from "@/lib/supabase/server"
import type { Item, Listing } from "@/lib/types"
import { fail, type ActionResult } from "./result"

const changeSchema = z.object({
  itemIds: z.array(z.uuid()).min(1).max(200),
  mode: z.enum(["suggested", "percent", "amount", "set"]),
  /** percent: 1–90; amount and set: cents; suggested: none (each item's sold median). */
  value: z.number().positive().max(100_000_000).optional(),
})

export type RepriceResult =
  | { ok: true; updated: number; skipped: number; synced: number; pending: number; failed: number }
  | { ok: false; error: string }

/** Bulk reprice: new list price on each item, pushed to every live listing. */
export async function repriceItems(input: z.input<typeof changeSchema>): Promise<RepriceResult> {
  try {
    const c = changeSchema.parse(input)
    if (!validChange(c)) throw new UserError(c.mode === "percent" ? "Drop by 1% to 90%." : "Enter a price.")
    const { supabase, userId } = await requireUser()
    const canUseApi = await canCrosslist()
    const { data, error } = await supabase
      .from("items")
      .select("*, listings:marketplace_listings(*)")
      .in("id", c.itemIds)
      .eq("status", "inventory")
    if (error) throw error
    const items = (data ?? []) as Item[]
    // Suggested prices are worked out here, never taken from the browser.
    const suggested = c.mode === "suggested" ? Object.fromEntries(await soldMedians(supabase, items, userId)) : {}
    const plan = planReprice(items.map((i) => ({ id: i.id, priceCents: askingPrice(i) })), c, suggested)
    let updated = 0, synced = 0, pending = 0, failed = 0
    for (const ch of plan.changes) {
      const { error: upErr } = await supabase.from("items").update({ list_price_cents: ch.to }).eq("id", ch.id)
      if (upErr) throw upErr
      updated++
      for (const o of await propagateToListings(supabase, ch.id, { priceCents: ch.to }, { canUseApi })) {
        if (o.status === "synced") synced++
        else if (o.status === "pending") pending++
        else failed++
      }
    }
    revalidatePath("/", "layout")
    return { ok: true, updated, skipped: plan.noPrice.length + plan.noSuggestion.length, synced, pending, failed }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

export type SuggestResult = { ok: true; prices: Record<string, number> } | { ok: false; error: string }

/** The reprice panel's "Suggested" prices: each item's recent sold median, where one is on file. */
export async function suggestPrices(itemIds: string[]): Promise<SuggestResult> {
  try {
    const ids = z.array(z.uuid()).min(1).max(200).parse(itemIds)
    const { supabase, userId } = await requireUser()
    const { data, error } = await supabase.from("items").select("id, title").in("id", ids).eq("status", "inventory")
    if (error) throw error
    return { ok: true, prices: Object.fromEntries(await soldMedians(supabase, data ?? [], userId)) }
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
    // Only this listing: re-running the whole item would re-send changes to listings that are fine.
    const out = (await propagateToListings(supabase, l.item_id, l.pending_changes ?? {}, { canUseApi: await canCrosslist(), listingId: l.id }))
      .find((o) => o.listingId === l.id)
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
