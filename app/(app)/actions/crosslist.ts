"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { z } from "zod"
import { applySaleChecks, type SaleCheckOutcome } from "@/lib/crosslist/assisted-sales"
import { takeDown } from "@/lib/crosslist/engine"
import { adapters, saleCheckStore, supabaseStore } from "@/lib/crosslist/store"
import {
  categoryAspects, categoryConditions, publishToEbay, suggestCategories,
  type Aspect, type CategorySuggestion, type ConditionOption,
} from "@/lib/marketplaces/ebay/adapter"
import { ebayConfig } from "@/lib/marketplaces/ebay/client"
import { setupGaps } from "@/lib/marketplaces/ebay/mapping"
import { getUserToken } from "@/lib/marketplaces/ebay/oauth"
import { createPolicies, ensureLocation, loadPolicies, saveSettings } from "@/lib/marketplaces/ebay/setup"
import { syncEbaySales } from "@/lib/marketplaces/ebay/sync"
import { checkPoshmarkListings } from "@/lib/marketplaces/assisted-sync"
import { marketplace, type MarketplaceId } from "@/lib/marketplaces/registry"
import { photoLink } from "@/lib/photo-links"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireUser } from "@/lib/supabase/server"
import type { Listing } from "@/lib/types"
import { reportError, UserError } from "@/lib/errors"
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

// ---- Sale checks by the Chrome extension (Poshmark, Mercari) ----

export type WatchedListing = { listingId: string; marketplace: string; url: string }

/** Live or to-be-delisted listings whose public page the extension should check. */
export async function extensionWatchList(): Promise<Result<WatchedListing[]>> {
  try {
    const { supabase } = await requireUser()
    const { data, error } = await supabase
      .from("marketplace_listings")
      .select("id, marketplace, external_url")
      .in("status", ["active", "delist_pending"])
      .in("marketplace", ["poshmark", "mercari"])
      .not("external_url", "is", null)
    if (error) throw error
    return { ok: true, data: data.map((l) => ({ listingId: l.id, marketplace: l.marketplace, url: l.external_url! })) }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

export type DelistJob = { listingId: string; itemId: string; marketplace: MarketplaceId; url: string; title: string }

/** Listings waiting to come down that the extension can take down by itself. */
export async function extensionDelistQueue(): Promise<Result<DelistJob[]>> {
  try {
    const { supabase } = await requireUser()
    const { data, error } = await supabase
      .from("marketplace_listings")
      .select("id, item_id, marketplace, external_url, items(title)")
      .eq("status", "delist_pending")
      .in("marketplace", ["facebook", "poshmark", "mercari"])
      .not("external_url", "is", null)
    if (error) throw error
    return {
      ok: true,
      data: data.map((l) => ({
        listingId: l.id,
        itemId: l.item_id,
        marketplace: l.marketplace as MarketplaceId,
        url: l.external_url!,
        title: ([l.items].flat()[0] as { title: string | null } | undefined)?.title ?? "",
      })),
    }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

const saleChecksSchema = z
  .array(
    z.object({
      listingId: z.uuid(),
      state: z.enum(["sold", "available", "unavailable", "unknown"]),
      priceCents: cents.nullable(),
    }),
  )
  .max(100)

/** Record what the extension found: new sales, and listings that are confirmed gone. */
export async function applyExtensionSaleChecks(input: unknown): Promise<Result<SaleCheckOutcome>> {
  try {
    const checks = saleChecksSchema.parse(input)
    const { supabase } = await requireUser()
    const out = await applySaleChecks(saleCheckStore(supabase, createAdminClient()), adapters, checks)
    if (out.sales.length || out.delisted) revalidatePath("/", "layout")
    return { ok: true, data: out }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
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

/** Everything eBay needs for a category: item specifics and the conditions it allows. */
export async function ebayCategoryDetails(
  categoryId: string,
): Promise<Result<{ aspects: Aspect[]; conditions: ConditionOption[]; conditionRequired: boolean }>> {
  try {
    const id = z.string().regex(/^\d+$/).parse(categoryId)
    const { userId } = await requireUser()
    const [aspects, cond] = await Promise.all([categoryAspects(userId, id), categoryConditions(userId, id)])
    return { ok: true, data: { aspects, conditions: cond.options, conditionRequired: cond.required } }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

const publishSchema = z.object({
  categoryId: z.string().regex(/^\d+$/, "Pick an eBay category"),
  conditionId: z.string().regex(/^\d+$/, "Pick the item's condition for eBay").optional(),
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
      conditionId: p.conditionId,
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

/**
 * Pull new sales now: eBay through its API, Poshmark by reading its public listing pages.
 * `ifOlderThanMs` lets the app call this cheaply on open. `sales` counts eBay; `poshmark` is what
 * changed there. Mercari can't be read from a server, so the extension checks it (checkExtensionSales).
 */
export async function syncSales(ifOlderThanMs = 0): Promise<Result<{ sales: number; poshmark: SaleCheckOutcome }>> {
  try {
    const { supabase, userId } = await requireUser()
    const admin = createAdminClient()

    let poshmark: SaleCheckOutcome = { sales: [], delisted: 0 }
    try {
      poshmark = await checkPoshmarkListings(supabase, admin, { staleMs: Math.max(ifOlderThanMs, 60_000), limit: 50 })
    } catch (e) {
      reportError(e, "poshmark check") // Don't let this stop the eBay sync.
    }

    let sales = 0
    const { data: conn } = await supabase
      .from("marketplace_connections")
      .select("last_synced_at")
      .eq("marketplace", "ebay")
      .maybeSingle()
    const fresh = ifOlderThanMs && conn?.last_synced_at && Date.now() - new Date(conn.last_synced_at).getTime() < ifOlderThanMs
    if (conn && !fresh) sales = (await syncEbaySales(admin, userId)).sales

    if (sales || poshmark.sales.length || poshmark.delisted) revalidatePath("/", "layout")
    return { ok: true, data: { sales, poshmark } }
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

const policyChoicesSchema = z.object({
  shipping: z.object({
    free: z.boolean(),
    costCents: z.number().int().min(0).max(10_000),
    handlingDays: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
  returns: z.object({ accepted: z.boolean() }),
})

/** Create starter business policies on the seller's eBay account for whatever isn't picked yet. */
export async function createEbayPolicies(input: z.input<typeof policyChoicesSchema>): Promise<ActionResult> {
  try {
    const choices = policyChoicesSchema.parse(input)
    const { userId } = await requireUser()
    const admin = createAdminClient()
    const auth = await getUserToken(userId, admin)
    if (!auth) throw new UserError("eBay isn't connected. Connect it in Settings → Marketplaces.")
    await saveSettings(admin, userId, await createPolicies(auth.token, auth.account.settings, choices))
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
