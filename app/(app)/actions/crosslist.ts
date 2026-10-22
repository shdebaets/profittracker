"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { z } from "zod"
import { takeDown } from "@/lib/crosslist/engine"
import { adapters, supabaseStore } from "@/lib/crosslist/store"
import {
  categoryAspects, publishToEbay, suggestCategories, type Aspect, type CategorySuggestion,
} from "@/lib/marketplaces/ebay/adapter"
import { ebayConfig } from "@/lib/marketplaces/ebay/client"
import { setupGaps } from "@/lib/marketplaces/ebay/mapping"
import { getUserToken } from "@/lib/marketplaces/ebay/oauth"
import { ensureLocation, loadPolicies, saveSettings } from "@/lib/marketplaces/ebay/setup"
import { syncEbaySales } from "@/lib/marketplaces/ebay/sync"
import { marketplace } from "@/lib/marketplaces/registry"
import { photoLink } from "@/lib/photo-links"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireUser } from "@/lib/supabase/server"
import type { Listing } from "@/lib/types"
import { UserError } from "@/lib/errors"
import { fail, type ActionResult } from "./result"

type Result<T> = { ok: true; data: T } | { ok: false; error: string }
const cents = z.number().int().min(0).max(100_000_000)
const assistedId = z.enum(["mercari", "facebook", "depop", "vinted", "poshmark"])

function done(): ActionResult {
  revalidatePath("/", "layout")
  return { ok: true }
}

const detailsSchema = z.object({
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  condition: z.enum(["new_with_tags", "new", "like_new", "good", "fair"]).nullable(),
  brand: z.string().trim().max(100).optional(),
  size: z.string().trim().max(50).optional(),
  listPriceCents: cents.nullable(),
})
export type ListingDetails = z.input<typeof detailsSchema>

export async function saveListingDetails(itemId: string, input: ListingDetails): Promise<ActionResult> {
  try {
    const d = detailsSchema.parse(input)
    const { supabase } = await requireUser()
    const { error } = await supabase
      .from("items")
      .update({
        ...(d.title !== undefined ? { title: d.title || null } : {}),
        description: d.description || null,
        condition: d.condition,
        brand: d.brand || null,
        size: d.size || null,
        list_price_cents: d.listPriceCents,
      })
      .eq("id", itemId)
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

/** The user listed it themselves on an assisted marketplace. */
export async function markAssistedListed(
  itemId: string,
  input: { marketplace: string; url?: string; priceCents?: number | null },
): Promise<ActionResult> {
  try {
    const m = assistedId.parse(input.marketplace)
    const url = z.union([z.literal(""), z.url().max(1000)]).optional().parse(input.url?.trim())
    const { supabase } = await requireUser()
    const { error } = await supabase.from("marketplace_listings").upsert(
      {
        item_id: itemId,
        marketplace: m,
        status: "active",
        external_url: url || null,
        price_cents: input.priceCents ?? null,
        listed_at: new Date().toISOString(),
        delisted_at: null,
        last_error: null,
      },
      { onConflict: "item_id,marketplace" },
    )
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

/**
 * End one listing: through the API for eBay, or confirm the user took it down by hand.
 * `manual` skips the API (e.g. the user ended it on eBay themselves after a failed attempt).
 */
export async function endListing(listingId: string, opts: { manual?: boolean } = {}): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser()
    const { data: l, error } = await supabase.from("marketplace_listings").select("*").eq("id", listingId).single()
    if (error) throw error
    const listing = l as Listing
    const adapter = marketplace(listing.marketplace).mode === "api" ? adapters[listing.marketplace] : undefined
    if (adapter && !opts.manual) await adapter.end(listing)
    const { error: upErr } = await supabase
      .from("marketplace_listings")
      .update({ status: "delisted", delisted_at: new Date().toISOString(), last_error: null })
      .eq("id", listingId)
    if (upErr) throw upErr
    return done()
  } catch (e) {
    return fail(e)
  }
}

/** Remove a listing record entirely (e.g. marked listed by mistake). Live API listings are ended first. */
export async function forgetListing(listingId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser()
    const { data: l, error } = await supabase.from("marketplace_listings").select("*").eq("id", listingId).single()
    if (error) throw error
    const listing = l as Listing
    if (listing.status === "active") {
      const adapter = marketplace(listing.marketplace).mode === "api" ? adapters[listing.marketplace] : undefined
      if (adapter) await adapter.end(listing)
    }
    const { error: delErr } = await supabase.from("marketplace_listings").delete().eq("id", listingId)
    if (delErr) throw delErr
    return done()
  } catch (e) {
    return fail(e)
  }
}

/** Take an unsold item down everywhere (e.g. kept it, or selling it in person). */
export async function delistEverywhere(itemId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser()
    const out = await takeDown(supabaseStore(supabase), adapters, itemId)
    if (out.failed.length) throw new UserError(`Couldn't end the ${marketplace(out.failed[0].marketplace).label} listing. ${out.failed[0].error}`)
    return done()
  } catch (e) {
    return fail(e)
  }
}

// ---- eBay ----

export async function ebayCategories(q: string): Promise<Result<CategorySuggestion[]>> {
  try {
    const query = z.string().trim().min(2).max(200).parse(q)
    const { userId } = await requireUser()
    return { ok: true, data: await suggestCategories(userId, query) }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

export async function ebayAspects(categoryId: string): Promise<Result<Aspect[]>> {
  try {
    const id = z.string().regex(/^\d+$/).parse(categoryId)
    const { userId } = await requireUser()
    return { ok: true, data: await categoryAspects(userId, id) }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

const publishSchema = z.object({
  categoryId: z.string().regex(/^\d+$/, "Pick an eBay category"),
  priceCents: cents.min(99, "eBay needs a price of at least $0.99"),
  aspects: z.record(z.string(), z.array(z.string().trim().min(1).max(65)).max(30)),
})

export async function publishEbay(itemId: string, input: z.input<typeof publishSchema>): Promise<ActionResult> {
  try {
    const p = publishSchema.parse(input)
    const { supabase, userId } = await requireUser()
    const { data: item, error } = await supabase.from("items").select("*").eq("id", itemId).single()
    if (error) throw error
    if (item.status !== "inventory") throw new UserError("Only unsold items can be listed.")
    if (!item.title) throw new UserError("Give the item a title first.")

    // Short signed links: eBay rejects picture URLs over 500 characters, and Supabase's are longer.
    const h = await headers()
    const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`
    const res = await publishToEbay(userId, {
      item,
      quantity: item.quantity,
      priceCents: p.priceCents,
      categoryId: p.categoryId,
      aspects: Object.fromEntries(Object.entries(p.aspects).filter(([, v]) => v.length)),
      imageUrls: ((item.photo_paths as string[]) ?? []).map((path) => photoLink(origin, path)),
    })
    const { error: upErr } = await supabase.from("marketplace_listings").upsert(
      {
        item_id: itemId,
        marketplace: "ebay",
        status: "active",
        external_id: res.listingId,
        offer_id: res.offerId,
        external_url: res.url,
        price_cents: p.priceCents,
        listed_at: new Date().toISOString(),
        delisted_at: null,
        last_error: null,
      },
      { onConflict: "item_id,marketplace" },
    )
    if (upErr) throw upErr
    if (item.list_price_cents == null) await supabase.from("items").update({ list_price_cents: p.priceCents }).eq("id", itemId)
    return done()
  } catch (e) {
    return fail(e)
  }
}

/** Pull new eBay sales now. `ifOlderThanMs` lets the app call this cheaply on open. */
export async function syncSales(ifOlderThanMs = 0): Promise<Result<{ sales: number }>> {
  try {
    const { supabase, userId } = await requireUser()
    const { data: conn } = await supabase
      .from("marketplace_connections")
      .select("last_synced_at")
      .eq("marketplace", "ebay")
      .maybeSingle()
    if (!conn) return { ok: true, data: { sales: 0 } }
    if (ifOlderThanMs && conn.last_synced_at && Date.now() - new Date(conn.last_synced_at).getTime() < ifOlderThanMs) {
      return { ok: true, data: { sales: 0 } }
    }
    const r = await syncEbaySales(createAdminClient(), userId)
    if (r.sales) revalidatePath("/", "layout")
    return { ok: true, data: r }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

const ebaySettingsSchema = z.object({
  fulfillmentPolicyId: z.string().max(40).optional(),
  paymentPolicyId: z.string().max(40).optional(),
  returnPolicyId: z.string().max(40).optional(),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Enter a 5-digit ZIP code").optional(),
})

export async function saveEbaySettings(input: z.input<typeof ebaySettingsSchema>): Promise<ActionResult> {
  try {
    const s = ebaySettingsSchema.parse(input)
    const { userId } = await requireUser()
    const admin = createAdminClient()
    const auth = await getUserToken(userId, admin)
    if (!auth) throw new UserError("eBay isn't connected. Connect it in Settings → Marketplaces.")
    const next = { ...auth.account.settings, ...s }
    if (s.postalCode && s.postalCode !== auth.account.settings.postalCode) {
      next.merchantLocationKey = await ensureLocation(auth.token, s.postalCode.slice(0, 5))
    }
    await saveSettings(admin, userId, next)
    return done()
  } catch (e) {
    return fail(e)
  }
}

export async function refreshEbayPolicies(): Promise<ActionResult> {
  try {
    const { userId } = await requireUser()
    const admin = createAdminClient()
    const auth = await getUserToken(userId, admin)
    if (!auth) throw new UserError("eBay isn't connected. Connect it in Settings → Marketplaces.")
    await saveSettings(admin, userId, await loadPolicies(auth.token, auth.account.settings))
    return done()
  } catch (e) {
    return fail(e)
  }
}

export async function disconnectEbay(): Promise<ActionResult> {
  try {
    const { userId } = await requireUser()
    const { error } = await createAdminClient()
      .from("marketplace_accounts")
      .delete()
      .eq("user_id", userId)
      .eq("marketplace", "ebay")
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

export type EbayStatus = { configured: boolean; connected: boolean; sandbox: boolean; username: string | null; gaps: string[] }

export async function getEbayStatus(): Promise<EbayStatus> {
  const { supabase } = await requireUser()
  const cfg = ebayConfig()
  const { data } = await supabase
    .from("marketplace_connections")
    .select("external_username, settings")
    .eq("marketplace", "ebay")
    .maybeSingle()
  return {
    configured: cfg.configured,
    connected: !!data,
    sandbox: cfg.sandbox,
    username: data?.external_username ?? null,
    gaps: data ? setupGaps(data.settings ?? {}) : [],
  }
}
