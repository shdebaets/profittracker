"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { takeDown } from "@/lib/crosslist/engine"
import { adapters, supabaseStore } from "@/lib/crosslist/store"
import { reportError, UserError } from "@/lib/errors"
import { marketplace } from "@/lib/marketplaces/registry"
import { requireMember } from "@/lib/supabase/server"
import type { Listing } from "@/lib/types"
import { fail, type ActionResult } from "./result"

const cents = z.number().int().min(0).max(100_000_000)
const id = z.string().uuid()

function done(): ActionResult {
  revalidatePath("/", "layout")
  return { ok: true }
}

// Metadata a split-off row keeps from the row it came from.
const COPIED = [
  "user_id", "title", "store", "link_url", "photo_paths", "description", "condition", "brand", "size", "category",
  "haul_id", "cost_cents", "cost_unknown", "purchased_at",
] as const

const copyOf = (item: Record<string, unknown>) => Object.fromEntries(COPIED.map((k) => [k, item[k]]))

const storeReturnSchema = z.object({
  id,
  quantity: z.number().int().min(1),
  /** What the store refunded for these units; null = all of it. */
  refundCents: cents.nullable(),
  refundReceived: z.boolean(),
  returnCostCents: cents.default(0),
  /** ISO timestamp; defaults to now. */
  returnedAt: z.string().datetime().optional(),
})
export type StoreReturnInput = z.input<typeof storeReturnSchema>

/**
 * Take unsold stock back to the store. All units: the row becomes `returned` and its listings come down.
 * Some units: they split off into a new `returned` row, and live API listings drop to what's left.
 */
export async function returnToStore(input: StoreReturnInput): Promise<ActionResult> {
  try {
    const r = storeReturnSchema.parse(input)
    const { supabase } = await requireMember()
    const { data: item, error: readErr } = await supabase.from("items").select("*").eq("id", r.id).single()
    if (readErr) throw readErr
    if (item.status !== "inventory") throw new UserError("Only items in your inventory can be returned to the store.")
    if (r.quantity > item.quantity) throw new UserError(`Only ${item.quantity} unit${item.quantity === 1 ? "" : "s"} in stock.`)
    const returnedAt = r.returnedAt ?? new Date().toISOString()
    const columns = {
      status: "returned",
      returned_at: returnedAt,
      store_refund_cents: r.refundCents,
      store_refund_received_at: r.refundReceived ? returnedAt : null,
      return_cost_cents: r.returnCostCents,
    }

    if (r.quantity === item.quantity) {
      await takeDown(supabaseStore(supabase), adapters, r.id)
      const { error } = await supabase.from("items").update(columns).eq("id", r.id).eq("status", "inventory")
      if (error) throw error
      return done()
    }

    const remaining = item.quantity - r.quantity
    const { data: dec, error: decErr } = await supabase
      .from("items")
      .update({ quantity: remaining })
      .eq("id", r.id)
      .eq("quantity", item.quantity) // guards against a double tap
      .select("id")
    if (decErr) throw decErr
    if (!dec?.length) throw new UserError("This item just changed. Refresh and try again.")
    const { error } = await supabase.from("items").insert({ ...copyOf(item), returnable: false, quantity: r.quantity, ...columns })
    if (error) throw error

    // Live API listings should only offer what's left.
    const listings = await supabaseStore(supabase).listings(r.id)
    for (const l of listings as Listing[]) {
      const adapter = l.status === "active" && marketplace(l.marketplace).mode === "api" ? adapters[l.marketplace] : undefined
      if (!adapter) continue
      try {
        await adapter.setQuantity(l, remaining)
      } catch (err) {
        reportError(err, `update ${l.marketplace} quantity after return`)
      }
    }
    return done()
  } catch (e) {
    return fail(e)
  }
}

/** The store's refund arrived (or, undoing, it hasn't). */
export async function setStoreRefundReceived(itemId: string, received: boolean): Promise<ActionResult> {
  try {
    const iid = id.parse(itemId)
    const { supabase } = await requireMember()
    const { error } = await supabase
      .from("items")
      .update({ store_refund_received_at: received ? new Date().toISOString() : null })
      .eq("id", iid)
      .eq("status", "returned")
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

/** Put a returned row back in stock (marked returned by mistake). Its listings stay ended. */
export async function undoStoreReturn(itemId: string): Promise<ActionResult> {
  try {
    const iid = id.parse(itemId)
    const { supabase } = await requireMember()
    const { error } = await supabase
      .from("items")
      .update({ status: "inventory", returned_at: null, store_refund_cents: null, store_refund_received_at: null, return_cost_cents: 0 })
      .eq("id", iid)
      .eq("status", "returned")
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

const buyerReturnSchema = z.object({
  id,
  /** Refunded to the buyer (Schedule C returns and allowances). */
  refundCents: cents,
  returnLabelCents: cents.default(0),
  feeCreditCents: cents.default(0),
  /** Put the units back into inventory to sell again. */
  restock: z.boolean(),
})
export type BuyerReturnInput = z.input<typeof buyerReturnSchema>

/**
 * A buyer sent a sold item back. The sale stays (it's still on the 1099-K) with the refund, fee credit
 * and return label recorded. Restocked units come back as a new inventory row; their cost leaves this
 * sale's COGS (calcSale) so it isn't counted twice.
 */
export async function buyerReturned(input: BuyerReturnInput): Promise<ActionResult> {
  try {
    const r = buyerReturnSchema.parse(input)
    const { supabase } = await requireMember()
    const { data: item, error: readErr } = await supabase.from("items").select("*").eq("id", r.id).single()
    if (readErr) throw readErr
    if (item.status !== "sold") throw new UserError("Only sold items can be returned by a buyer.")
    if (item.buyer_returned_at) throw new UserError("This sale is already marked as returned.")
    const paid = (item.sale_price_cents ?? 0) * item.quantity + (item.buyer_shipping_cents ?? 0)
    if (r.refundCents > paid) throw new UserError("The refund can't be more than the buyer paid.")

    // Claim the sale first so a double tap can't restock twice.
    const now = new Date().toISOString()
    const { data: claimed, error: claimErr } = await supabase
      .from("items")
      .update({
        buyer_returned_at: now,
        refund_cents: r.refundCents,
        return_label_cents: r.returnLabelCents,
        fee_credit_cents: r.feeCreditCents,
        restocked: r.restock,
      })
      .eq("id", r.id)
      .is("buyer_returned_at", null)
      .select("id")
    if (claimErr) throw claimErr
    if (!claimed?.length) throw new UserError("This sale is already marked as returned.")

    if (r.restock) {
      const { data: back, error } = await supabase
        .from("items")
        .insert({ ...copyOf(item), status: "inventory", returnable: false, quantity: item.quantity })
        .select("id")
        .single()
      if (error) {
        await supabase.from("items").update({ buyer_returned_at: null, refund_cents: item.refund_cents ?? 0, return_label_cents: 0, fee_credit_cents: 0, restocked: false }).eq("id", r.id)
        throw error
      }
      await supabase.from("items").update({ restocked_item_id: back.id }).eq("id", r.id)
    }
    return done()
  } catch (e) {
    return fail(e)
  }
}

/** Undo a buyer return: clears it from the sale and removes the restocked row if it hasn't moved since. */
export async function undoBuyerReturn(itemId: string): Promise<ActionResult> {
  try {
    const iid = id.parse(itemId)
    const { supabase } = await requireMember()
    const { data: item, error: readErr } = await supabase.from("items").select("buyer_returned_at, restocked_item_id").eq("id", iid).single()
    if (readErr) throw readErr
    if (!item.buyer_returned_at) return done()
    if (item.restocked_item_id) {
      const { data: back } = await supabase.from("items").select("status").eq("id", item.restocked_item_id).maybeSingle()
      if (back && back.status !== "inventory") {
        throw new UserError("The returned unit has been sold or returned since, so this can't be undone. Edit the sale instead.")
      }
      if (back) {
        const { error } = await supabase.from("items").delete().eq("id", item.restocked_item_id).eq("status", "inventory")
        if (error) throw error
      }
    }
    const { error } = await supabase
      .from("items")
      .update({ buyer_returned_at: null, refund_cents: 0, return_label_cents: 0, fee_credit_cents: 0, restocked: false, restocked_item_id: null })
      .eq("id", iid)
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}
