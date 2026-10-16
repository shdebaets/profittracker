"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireUser } from "@/lib/supabase/server"
import { distributeHaul } from "@/lib/profit"
import { fail, type ActionResult } from "./result"

const cents = z.number().int().min(0).max(100_000_000)
const platform = z.enum(["cash", "card", "mercari_depop", "ebay", "poshmark_amz", "custom"])

const saleFields = z.object({
  salePriceCents: cents,
  buyerShippingCents: cents.default(0),
  labelCostCents: cents.default(0),
  feePct: z.number().min(0).max(1),
  feeFixedCents: cents.default(0),
  platform,
  soldAt: z.string().optional(),
})

const itemSchema = z.object({
  mode: z.enum(["sold", "inventory"]),
  title: z.string().trim().max(200).optional(),
  linkUrl: z.string().trim().max(1000).optional(),
  store: z.string().trim().max(100).optional(),
  costCents: cents,
  quantity: z.number().int().min(1).max(100_000),
  returnable: z.boolean().default(false),
  returnDeadline: z.string().nullable().optional(),
  purchasedAt: z.string().optional(),
  sale: saleFields.optional(),
})
export type ItemInput = z.input<typeof itemSchema>

function saleColumns(s: z.output<typeof saleFields>) {
  return {
    sale_price_cents: s.salePriceCents,
    buyer_shipping_cents: s.buyerShippingCents,
    label_cost_cents: s.labelCostCents,
    fee_pct: s.feePct,
    fee_fixed_cents: s.feeFixedCents,
    platform: s.platform,
    sold_at: s.soldAt ? new Date(s.soldAt).toISOString() : new Date().toISOString(),
  }
}

function baseColumns(i: z.output<typeof itemSchema>) {
  return {
    title: i.title || null,
    link_url: i.linkUrl || null,
    store: i.store || null,
    cost_cents: i.costCents,
    quantity: i.quantity,
    returnable: i.returnable,
    return_deadline: i.returnable ? i.returnDeadline || null : null,
    ...(i.purchasedAt ? { purchased_at: new Date(i.purchasedAt).toISOString() } : {}),
  }
}

function done(): ActionResult {
  revalidatePath("/", "layout")
  return { ok: true }
}

export async function createItem(input: ItemInput): Promise<ActionResult> {
  try {
    const i = itemSchema.parse(input)
    if (i.mode === "sold" && !i.sale) throw new Error("Sale details are required")
    const { supabase } = await requireUser()
    const { error } = await supabase.from("items").insert({
      ...baseColumns(i),
      status: i.mode,
      ...(i.mode === "sold" && i.sale ? saleColumns(i.sale) : {}),
    })
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

export async function updateItem(id: string, input: ItemInput): Promise<ActionResult> {
  try {
    const i = itemSchema.parse(input)
    const { supabase } = await requireUser()
    const { error } = await supabase
      .from("items")
      .update({ ...baseColumns(i), ...(i.sale ? saleColumns(i.sale) : {}) })
      .eq("id", id)
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

/** Sell some or all units of an inventory lot. A partial sale splits the row. */
export async function markSold(
  id: string,
  input: { quantity: number } & z.input<typeof saleFields>,
): Promise<ActionResult> {
  try {
    const qty = z.number().int().min(1).parse(input.quantity)
    const sale = saleColumns(saleFields.parse(input))
    const { supabase } = await requireUser()
    const { data: item, error: readErr } = await supabase.from("items").select("*").eq("id", id).single()
    if (readErr) throw readErr
    if (item.status !== "inventory") throw new Error("Item is not in inventory")
    if (qty > item.quantity) throw new Error(`Only ${item.quantity} units in stock`)

    if (qty === item.quantity) {
      const { error } = await supabase.from("items").update({ status: "sold", ...sale }).eq("id", id)
      if (error) throw error
    } else {
      const { error: decErr } = await supabase
        .from("items")
        .update({ quantity: item.quantity - qty })
        .eq("id", id)
        .eq("quantity", item.quantity) // optimistic guard against double-submit
      if (decErr) throw decErr
      const { error } = await supabase.from("items").insert({
        title: item.title,
        store: item.store,
        link_url: item.link_url,
        haul_id: item.haul_id,
        cost_cents: item.cost_cents,
        purchased_at: item.purchased_at,
        returnable: false,
        quantity: qty,
        status: "sold",
        ...sale,
      })
      if (error) throw error
    }
    return done()
  } catch (e) {
    return fail(e)
  }
}

export async function markReturned(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser()
    const { error } = await supabase.from("items").update({ status: "returned" }).eq("id", id)
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

export async function deleteItem(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser()
    const { error } = await supabase.from("items").delete().eq("id", id)
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

const haulSchema = z.object({
  title: z.string().trim().max(200).optional(),
  store: z.string().trim().max(100).optional(),
  totalCents: cents,
  purchasedAt: z.string().optional(),
  returnable: z.boolean().default(false),
  returnDeadline: z.string().nullable().optional(),
  lines: z
    .array(
      z.object({
        title: z.string().trim().min(1, "Every haul item needs a name").max(200),
        quantity: z.number().int().min(1),
        estValueCents: cents.default(0),
      }),
    )
    .min(1, "Add at least one item"),
})
export type HaulInput = z.input<typeof haulSchema>

export async function createHaul(input: HaulInput): Promise<ActionResult> {
  try {
    const h = haulSchema.parse(input)
    const { supabase } = await requireUser()
    const purchased_at = h.purchasedAt ? new Date(h.purchasedAt).toISOString() : new Date().toISOString()
    const { data: haul, error } = await supabase
      .from("hauls")
      .insert({ title: h.title || null, store: h.store || null, total_cents: h.totalCents, purchased_at })
      .select("id")
      .single()
    if (error) throw error

    const split = distributeHaul(h.totalCents, h.lines)
    // Insert one at a time so the seq trigger numbers them in order.
    for (const [idx, line] of h.lines.entries()) {
      const { error: insErr } = await supabase.from("items").insert({
        title: line.title,
        store: h.store || null,
        quantity: line.quantity,
        cost_cents: split[idx].unitCostCents,
        purchased_at,
        haul_id: haul.id,
        status: "inventory",
        returnable: h.returnable,
        return_deadline: h.returnable ? h.returnDeadline || null : null,
      })
      if (insErr) throw insErr
    }
    return done()
  } catch (e) {
    return fail(e)
  }
}
