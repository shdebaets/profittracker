"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { UserError } from "@/lib/errors"
import { detectCarrier, normalizeTracking, statusWithTracking, type IncomingStatus } from "@/lib/incoming"
import { insertHaul } from "@/lib/items/haul-insert"
import { requireMember } from "@/lib/supabase/server"
import { fail, type ActionResult } from "./result"

const cents = z.number().int().min(0).max(100_000_000)
const id = z.string().uuid()

const incomingSchema = z.object({
  retailer: z.string().trim().max(100).optional(),
  orderNumber: z.string().trim().max(100).optional(),
  /** ISO timestamp. */
  orderedAt: z.string().datetime().optional(),
  totalCents: cents,
  lines: z
    .array(
      z.object({
        title: z.string().trim().min(1, "Every item needs a name").max(200),
        quantity: z.number().int().min(1).max(100_000),
        estValueCents: cents.default(0),
      }),
    )
    .min(1, "Add at least one item")
    .max(100),
  trackingNumber: z.string().trim().max(60).optional(),
  returnable: z.boolean().default(false),
  returnDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: z.string().trim().max(500).optional(),
})
export type IncomingInput = z.input<typeof incomingSchema>

function columns(i: z.output<typeof incomingSchema>) {
  const tracking = i.trackingNumber ? normalizeTracking(i.trackingNumber) : null
  return {
    retailer: i.retailer || null,
    order_number: i.orderNumber || null,
    total_cents: i.totalCents,
    lines: i.lines,
    tracking_number: tracking,
    carrier: tracking ? detectCarrier(tracking) : null,
    returnable: i.returnable,
    return_deadline: i.returnable ? i.returnDeadline || null : null,
    note: i.note || null,
    ...(i.orderedAt ? { ordered_at: i.orderedAt } : {}),
  }
}

function done(): ActionResult {
  revalidatePath("/", "layout")
  return { ok: true }
}

export async function createIncoming(input: IncomingInput): Promise<ActionResult> {
  try {
    const i = incomingSchema.parse(input)
    const { supabase } = await requireMember()
    const c = columns(i)
    const { error } = await supabase.from("incoming_orders").insert({ ...c, status: statusWithTracking("ordered", c.tracking_number) })
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

export async function updateIncoming(orderId: string, input: IncomingInput): Promise<ActionResult> {
  try {
    const oid = id.parse(orderId)
    const i = incomingSchema.parse(input)
    const { supabase } = await requireMember()
    const { data: before, error: readErr } = await supabase.from("incoming_orders").select("status, received_at").eq("id", oid).single()
    if (readErr) throw readErr
    const c = columns(i)
    // A received order's lines are already items; editing them here would no longer match.
    const update = before.received_at ? { ...c, lines: undefined, total_cents: undefined } : c
    const { error } = await supabase
      .from("incoming_orders")
      .update({ ...update, status: statusWithTracking(before.status as IncomingStatus, c.tracking_number) })
      .eq("id", oid)
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

/** Cancel, or undo a cancel (back to ordered/shipped by whether it has tracking). */
export async function setIncomingCancelled(orderId: string, cancelled: boolean): Promise<ActionResult> {
  try {
    const oid = id.parse(orderId)
    const { supabase } = await requireMember()
    const { data: o, error: readErr } = await supabase.from("incoming_orders").select("tracking_number, received_at").eq("id", oid).single()
    if (readErr) throw readErr
    if (o.received_at) throw new UserError("This order is already in your inventory, so it can't be cancelled here.")
    const status: IncomingStatus = cancelled ? "cancelled" : statusWithTracking("ordered", o.tracking_number)
    const { error } = await supabase.from("incoming_orders").update({ status }).eq("id", oid)
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

/**
 * The order arrived: its lines become inventory, costed from the order total (one item, or a lot when
 * there are several lines), dated the day it was ordered, with the order's return window.
 */
export async function receiveIncoming(orderId: string): Promise<ActionResult> {
  try {
    const oid = id.parse(orderId)
    const { supabase } = await requireMember()
    const { data: o, error: readErr } = await supabase.from("incoming_orders").select("*").eq("id", oid).single()
    if (readErr) throw readErr
    if (o.received_at) throw new UserError("This order is already in your inventory.")
    if (o.status === "cancelled") throw new UserError("This order was cancelled. Undo the cancel first.")
    const lines = z.array(incomingSchema.shape.lines.element).min(1).parse(o.lines)
    // Claim the order first so a double tap can't add the items twice.
    const receivedAt = new Date().toISOString()
    const { data: claimed, error: claimErr } = await supabase
      .from("incoming_orders")
      .update({ received_at: receivedAt, status: "delivered" })
      .eq("id", oid)
      .is("received_at", null)
      .select("id")
    if (claimErr) throw claimErr
    if (!claimed?.length) throw new UserError("This order is already in your inventory.")

    try {
      const deadline = o.returnable ? (o.return_deadline as string | null) : null
      let haulId: string | null = null
      if (lines.length === 1) {
        const l = lines[0]
        const { error } = await supabase.from("items").insert({
          title: l.title,
          store: o.retailer,
          quantity: l.quantity,
          cost_cents: Math.round(o.total_cents / l.quantity),
          purchased_at: o.ordered_at,
          status: "inventory",
          returnable: !!deadline,
          return_deadline: deadline,
        })
        if (error) throw error
      } else {
        haulId = await insertHaul(supabase, {
          title: o.order_number ? `${o.retailer ?? "Order"} #${o.order_number}` : o.retailer,
          store: o.retailer,
          totalCents: o.total_cents,
          purchasedAt: o.ordered_at,
          returnable: !!deadline,
          returnDeadline: deadline,
          splitMode: lines.some((l) => l.estValueCents > 0) ? "value" : "even",
          receiptPath: null,
          lines,
        })
        await supabase.from("incoming_orders").update({ haul_id: haulId }).eq("id", oid)
      }
    } catch (e) {
      // Put the order back so the seller can try again.
      await supabase.from("incoming_orders").update({ received_at: null, status: o.status }).eq("id", oid)
      throw e
    }
    return done()
  } catch (e) {
    return fail(e)
  }
}

export async function deleteIncoming(orderId: string): Promise<ActionResult> {
  try {
    const oid = id.parse(orderId)
    const { supabase } = await requireMember()
    const { error } = await supabase.from("incoming_orders").delete().eq("id", oid)
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}
