"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { judgeTitles } from "@/lib/comps/judge"
import { isPick, lookupComps, searchPhrase, type CompLookup, type CompPick } from "@/lib/comps/lookup"
import { overpricedItems, type Overpriced } from "@/lib/comps/overpriced"
import { median, queryKey } from "@/lib/comps/stats"
import type { Item } from "@/lib/types"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireUser } from "@/lib/supabase/server"
import { UserError } from "@/lib/errors"
import { fail, type ActionResult } from "./result"

export type LookupResult = { ok: true; lookup: CompLookup } | { ok: true; pick: CompPick } | { ok: false; error: string }

/**
 * Scan to Comp: a barcode or keywords → live listings plus any sold history we have.
 * Loose keywords that match several products return `pick`; call again with the chosen `product`.
 */
export async function compLookup(input: string, product?: string | null): Promise<LookupResult> {
  try {
    const q = z.string().trim().min(2, "Scan a barcode or type what it is").max(120).parse(input)
    const p = z.string().trim().max(120).nullable().optional().parse(product)
    const { supabase, userId } = await requireUser()
    const r = await lookupComps(supabase, q, { userId, product: p })
    return isPick(r) ? { ok: true, pick: r } : { ok: true, lookup: r }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

const soldRow = z.object({
  external_id: z.string().regex(/^\d{9,15}$/),
  title: z.string().min(1).max(200),
  price: z.number().positive().max(100000),
  shipping: z.number().min(0).max(10000).nullable(),
  sold_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  best_offer: z.boolean().default(false),
  condition: z.string().max(80).nullable().optional(),
})

/** Sold listings the extension read from eBay's public sold search for `query`. Shared market data. */
export async function saveSoldComps(query: string, rows: unknown): Promise<ActionResult & { saved?: number }> {
  try {
    await requireUser()
    const key = queryKey(z.string().min(2).max(120).parse(query))
    const parsed = z.array(z.unknown()).max(5000).parse(rows).flatMap((r) => {
      const p = soldRow.safeParse(r)
      return p.success ? [p.data] : []
    })
    if (!parsed.length) return { ok: true, saved: 0 }
    // comp_sales has no insert policy: validated rows only, through the service role.
    const { error } = await createAdminClient()
      .from("comp_sales")
      .upsert(
        parsed.map((r) => ({
          query_key: key,
          external_id: r.external_id,
          title: r.title,
          price_cents: Math.round(r.price * 100),
          shipping_cents: r.shipping == null ? null : Math.round(r.shipping * 100),
          sold_on: r.sold_on,
          best_offer: r.best_offer,
          condition: r.condition ?? null,
          collected_at: new Date().toISOString(),
        })),
        { onConflict: "query_key,external_id" },
      )
    if (error) throw error
    return { ok: true, saved: parsed.length }
  } catch (e) {
    return fail(e)
  }
}

const trackSchema = z.object({
  query: z.string().trim().min(2).max(120),
  gtin: z.string().regex(/^\d{8,14}$/).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  product: z.string().max(120).nullable().optional(),
  image: z.url().max(500).nullable().optional(),
  targetCostCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
})

export async function trackProduct(input: z.input<typeof trackSchema>): Promise<ActionResult> {
  try {
    const t = trackSchema.parse(input)
    const { supabase, userId } = await requireUser()
    const { error } = await supabase.from("tracked_products").upsert(
      { user_id: userId, query: t.query, gtin: t.gtin ?? null, title: t.title ?? null, product: t.product ?? null, image_url: t.image ?? null, target_cost_cents: t.targetCostCents ?? null },
      { onConflict: "user_id,query" },
    )
    if (error) throw error
    revalidatePath("/comp")
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function untrackProduct(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser()
    const { error } = await supabase.from("tracked_products").delete().eq("id", z.uuid().parse(id))
    if (error) throw error
    revalidatePath("/comp")
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/** Re-check one tracked product's numbers and save them. */
export async function refreshTracked(id: string): Promise<ActionResult> {
  try {
    const { supabase, userId } = await requireUser()
    const { data: t, error } = await supabase.from("tracked_products").select("query, gtin, product").eq("id", z.uuid().parse(id)).single()
    if (error) throw error
    // Old tracked rows have no product: their query is already the narrowed search phrase.
    const l = await lookupComps(supabase, t.gtin ?? t.query, { userId, product: t.gtin ? null : t.product ?? t.query })
    if (isPick(l)) throw new UserError("Open this product and pick which one you mean, then track it again.")
    const { error: upErr } = await supabase
      .from("tracked_products")
      .update({ stats: l.stats, title: l.title, image_url: l.image, checked_at: new Date().toISOString() })
      .eq("id", id)
    if (upErr) throw upErr
    revalidatePath("/comp")
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export type OverpricedResult = { ok: true; items: Overpriced[]; checked: number } | { ok: false; error: string }

/** Compare each priced inventory item with the sold comps on file for its title (last 90 days). */
export async function findOverpriced(): Promise<OverpricedResult> {
  try {
    const { supabase, userId } = await requireUser()
    const { data, error } = await supabase.from("items").select("*, listings:marketplace_listings(*)").eq("status", "inventory")
    if (error) throw error
    const items = (data ?? []) as Item[]
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
    const medians = new Map<string, number>()
    let checked = 0
    for (const i of items) {
      if (!i.title) continue
      const { data: rows } = await supabase
        .from("comp_sales")
        .select("title, price_cents, shipping_cents, best_offer")
        .eq("query_key", queryKey(searchPhrase(i.title)))
        .gte("sold_on", since)
        .limit(500)
      if (!rows?.length) continue
      // Same AI judge as Scan to Comp, so a case or a lot doesn't drag the median down.
      const judge = await judgeTitles(i.title, rows.map((r) => r.title), userId)
      const prices = rows.filter((r) => !r.best_offer && judge.keep(r.title)).map((r) => r.price_cents + (r.shipping_cents ?? 0))
      const med = median(prices)
      if (med && prices.length >= 3) {
        medians.set(i.id, med)
        checked++
      }
    }
    return { ok: true, items: overpricedItems(items, medians), checked }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}
