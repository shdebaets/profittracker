"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { UserError } from "@/lib/errors"
import { requireUser } from "@/lib/supabase/server"
import { fail, type ActionResult } from "./result"

const cents = z.number().int().min(0).max(100_000_000)

function done(): ActionResult {
  revalidatePath("/", "layout")
  return { ok: true }
}

const cancelledSchema = z.object({
  platform: z.enum(["ebay", "mercari", "poshmark", "facebook", "depop", "local", "other"]),
  grossCents: cents.refine((c) => c > 0, "Enter the sale amount"),
  cancelledAt: z.string().min(1),
  title: z.string().trim().max(200).optional(),
})

/** Log a cancelled sale. Poshmark can still count these on the 1099-K, so the reconciler shows them. */
export async function addCancelledSale(input: z.input<typeof cancelledSchema>): Promise<ActionResult> {
  try {
    const c = cancelledSchema.parse(input)
    const { supabase, userId } = await requireUser()
    const { error } = await supabase.from("cancelled_sales").insert({
      user_id: userId,
      platform: c.platform,
      gross_cents: c.grossCents,
      cancelled_at: new Date(c.cancelledAt).toISOString(),
      title: c.title || null,
    })
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

export async function deleteCancelledSale(id: string): Promise<ActionResult> {
  try {
    const sid = z.string().uuid().parse(id)
    const { supabase } = await requireUser()
    const { error } = await supabase.from("cancelled_sales").delete().eq("id", sid)
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

const refundSchema = z.object({ itemId: z.string().uuid(), refundCents: cents })

/** Set how much of a sale was refunded to the buyer (0 clears it). Can't exceed what the buyer paid. */
export async function setRefund(input: z.input<typeof refundSchema>): Promise<ActionResult> {
  try {
    const r = refundSchema.parse(input)
    const { supabase } = await requireUser()
    const { data: item, error: readErr } = await supabase
      .from("items")
      .select("status, sale_price_cents, quantity, buyer_shipping_cents")
      .eq("id", r.itemId)
      .maybeSingle()
    if (readErr) throw readErr
    if (!item || item.status !== "sold") throw new UserError("Only a sold item can have a refund.")
    const paid = (item.sale_price_cents ?? 0) * item.quantity + (item.buyer_shipping_cents ?? 0)
    if (r.refundCents > paid) throw new UserError("A refund can't be more than the buyer paid.")
    const { error } = await supabase.from("items").update({ refund_cents: r.refundCents }).eq("id", r.itemId)
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}
