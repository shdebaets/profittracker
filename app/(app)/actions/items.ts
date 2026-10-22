"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireUser } from "@/lib/supabase/server"
import { recordSale, takeDown, type SaleOutcome } from "@/lib/crosslist/engine"
import { adapters, supabaseStore } from "@/lib/crosslist/store"
import type { SaleColumns } from "@/lib/items/sell"
import type { MarketplaceId } from "@/lib/marketplaces/registry"
import { UserError } from "@/lib/errors"
import { marketplace } from "@/lib/marketplaces/registry"
import { removeUnreferencedPhotos } from "@/lib/photos"
import { distributeHaul } from "@/lib/profit"
import { fail, type ActionResult } from "./result"

const cents = z.number().int().min(0).max(100_000_000)
const platform = z.enum(["cash", "card", "mercari_depop", "ebay", "poshmark_amz", "custom"])
const marketplaceId = z.enum(["ebay", "mercari", "facebook", "depop", "vinted", "poshmark", "etsy"])

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
  photoPaths: z.array(z.string().max(200)).max(12).default([]),
})
export type ItemInput = z.input<typeof itemSchema>

function saleColumns(s: z.output<typeof saleFields>): SaleColumns {
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
    photo_paths: i.photoPaths,
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
    if (i.mode === "sold" && !i.sale) throw new UserError("Enter the sale details.")
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
    const { data: before } = await supabase.from("items").select("photo_paths").eq("id", id).single()
    const { error } = await supabase
      .from("items")
      .update({ ...baseColumns(i), ...(i.sale ? saleColumns(i.sale) : {}) })
      .eq("id", id)
    if (error) throw error
    const dropped = ((before?.photo_paths as string[] | undefined) ?? []).filter((p) => !i.photoPaths.includes(p))
    await removeUnreferencedPhotos(supabase, dropped)
    return done()
  } catch (e) {
    return fail(e)
  }
}

/** Sell some or all units of an inventory lot, then take it down on the other marketplaces. */
export async function markSold(
  id: string,
  input: { quantity: number; soldOn?: MarketplaceId | null } & z.input<typeof saleFields>,
): Promise<ActionResult & { outcome?: SaleOutcome }> {
  try {
    const qty = z.number().int().min(1).parse(input.quantity)
    const soldOn = marketplaceId.nullable().optional().parse(input.soldOn)
    const sale = saleColumns(saleFields.parse(input))
    const { supabase } = await requireUser()
    const outcome = await recordSale(supabaseStore(supabase), adapters, { itemId: id, qty, sale, soldOn })
    revalidatePath("/", "layout")
    return { ok: true, outcome }
  } catch (e) {
    return fail(e)
  }
}

export async function markReturned(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser()
    await takeDown(supabaseStore(supabase), adapters, id)
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
    // Listings cascade-delete with the item, so end any live API listing first.
    const down = await takeDown(supabaseStore(supabase), adapters, id)
    if (down.failed.length) throw new UserError(`Couldn't end the ${marketplace(down.failed[0].marketplace).label} listing, so the item wasn't deleted. ${down.failed[0].error}`)
    const { data: gone, error } = await supabase.from("items").delete().eq("id", id).select("photo_paths").single()
    if (error) throw error
    await removeUnreferencedPhotos(supabase, (gone.photo_paths as string[]) ?? [])
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
