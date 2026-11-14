"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { ASSISTED_OFFER_SITES, dueOffers, type DueOffer, type OfferCandidate } from "@/lib/offers-assisted"
import type { OfferRule } from "@/lib/offers"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireCrosslister } from "@/lib/supabase/server"
import { fail, type ActionResult } from "./result"

const ruleSchema = z
  .object({
    enabled: z.boolean(),
    discountPct: z.number().int().min(5).max(50),
    maxDiscountPct: z.number().int().min(5).max(60),
    floorMarginPct: z.number().int().min(0).max(300),
    minAgeDays: z.number().int().min(0).max(365),
    everyDays: z.number().int().min(1).max(14),
  })
  .refine((r) => r.maxDiscountPct >= r.discountPct, { message: "The max discount has to be at least the starting discount" })

export async function saveOfferRules(input: z.input<typeof ruleSchema>): Promise<ActionResult> {
  try {
    const r = ruleSchema.parse(input)
    const { supabase, userId } = await requireCrosslister()
    const { error } = await supabase.from("smart_offer_rules").upsert({
      user_id: userId,
      enabled: r.enabled,
      discount_pct: r.discountPct,
      max_discount_pct: r.maxDiscountPct,
      floor_margin_pct: r.floorMarginPct,
      min_age_days: r.minAgeDays,
      every_days: r.everyDays,
      updated_at: new Date().toISOString(),
    })
    if (error) throw error
    revalidatePath("/settings")
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export type AssistedOffersResult = { ok: true; offers: DueOffer[] } | { ok: false; error: string }

/** Poshmark and Mercari listings due an offer under the seller's Smart Offers rules. */
export async function getAssistedOffers(): Promise<AssistedOffersResult> {
  try {
    const { supabase } = await requireCrosslister()
    const [{ data: rule }, { data: listings, error }, { data: sent }] = await Promise.all([
      supabase.from("smart_offer_rules").select("*").maybeSingle<OfferRule & { enabled: boolean }>(),
      supabase
        .from("marketplace_listings")
        .select("id, item_id, marketplace, external_url, listed_at, price_cents, item:items(title, cost_cents, cost_unknown, list_price_cents, status)")
        .in("marketplace", [...ASSISTED_OFFER_SITES])
        .eq("status", "active"),
      supabase.from("smart_offers").select("listing_id, sent_at").in("marketplace", [...ASSISTED_OFFER_SITES]).order("sent_at", { ascending: false }).limit(500),
    ])
    if (error) throw error
    if (!rule?.enabled) return { ok: true, offers: [] }
    const lastSent = new Map<string, string>()
    for (const s of sent ?? []) if (!lastSent.has(s.listing_id)) lastSent.set(s.listing_id, s.sent_at)
    type Row = { id: string; item_id: string; marketplace: string; external_url: string | null; listed_at: string | null; price_cents: number | null; item: unknown }
    const candidates: OfferCandidate[] = ((listings ?? []) as Row[]).flatMap((l) => {
      const item = (Array.isArray(l.item) ? l.item[0] : l.item) as { title: string | null; cost_cents: number; cost_unknown: boolean; list_price_cents: number | null; status: string } | null
      if (!item || item.status !== "inventory") return []
      return [{
        listingId: l.id,
        itemId: l.item_id,
        marketplace: l.marketplace,
        title: item.title ?? "Item",
        url: l.external_url,
        listedAt: l.listed_at,
        listPriceCents: l.price_cents ?? item.list_price_cents,
        costCents: item.cost_unknown ? null : item.cost_cents,
      }]
    })
    return { ok: true, offers: dueOffers(candidates, lastSent, rule).slice(0, 30) }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

/** The seller sent a Poshmark/Mercari offer (the extension filled it, or they did it by hand). */
export async function logAssistedOffer(input: { listingId: string; offerCents: number }): Promise<ActionResult> {
  try {
    const { listingId, offerCents } = z.object({ listingId: z.uuid(), offerCents: z.number().int().positive().max(10_000_000) }).parse(input)
    const { supabase, userId } = await requireCrosslister()
    const { data: l, error } = await supabase
      .from("marketplace_listings")
      .select("id, item_id, marketplace, price_cents, item:items(title, list_price_cents)")
      .eq("id", listingId)
      .single()
    if (error) throw error
    const item = (Array.isArray(l.item) ? l.item[0] : l.item) as { title: string | null; list_price_cents: number | null } | null
    // smart_offers has no insert policy (the eBay cron writes it); scoped to this user's own listing above.
    const { error: insErr } = await createAdminClient().from("smart_offers").insert({
      user_id: userId,
      item_id: l.item_id,
      listing_id: l.id,
      marketplace: l.marketplace,
      title: item?.title ?? null,
      list_price_cents: l.price_cents ?? item?.list_price_cents ?? offerCents,
      offer_cents: offerCents,
    })
    if (insErr) throw insErr
    revalidatePath("/settings")
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
