"use server"

import { revalidatePath } from "next/cache"
import { start } from "workflow/api"
import { z } from "zod"
import { UserError } from "@/lib/errors"
import { buildProfile, identify, type Candidate } from "@/lib/research/ai"
import { todayET } from "@/lib/research/days"
import { DAILY_NEW_CHECKS, REFRESH_MIN_HOURS } from "@/lib/research/limits"
import { saveSoldRows, startRun, updateRun } from "@/lib/research/pipeline"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireUser } from "@/lib/supabase/server"
import { matchSoldHistory, trackProduct } from "@/workflows/research"
import { fail, type ActionResult } from "./result"


const query = z.string().trim().min(2).max(120)
const uuid = z.string().uuid()

export type ExistingMatch = { id: string; name: string; image_url: string | null }
export type SearchResult =
  | { ok: true; existing: ExistingMatch[]; candidates: Candidate[]; checksLeft: number | null }
  | { ok: false; error: string }

/** Remaining free checks today (null = unlimited). */
async function checksLeft(userId: string) {
  const admin = createAdminClient()
  const { data: member } = await admin.from("research_members").select("role").eq("user_id", userId).maybeSingle()
  if (member) return null
  const { data } = await admin.from("research_usage").select("new_checks").eq("user_id", userId).eq("day", todayET()).maybeSingle()
  return Math.max(0, DAILY_NEW_CHECKS - (data?.new_checks ?? 0))
}

/**
 * Search: products already researched (free, shared by everyone) plus what eBay's
 * results contain, identified by AI.
 */
export async function searchResearch(raw: string): Promise<SearchResult> {
  try {
    const q = query.parse(raw)
    const { supabase, userId } = await requireUser()
    const words = q.split(/\s+/).filter((w) => w.length > 1).slice(0, 6)
    let existingQuery = supabase.from("research_products").select("id,name,image_url").eq("status", "active").limit(5)
    for (const w of words) existingQuery = existingQuery.ilike("name", `%${w.replace(/[%_]/g, "")}%`)
    const [{ data: existing }, candidates, left] = await Promise.all([existingQuery, identify(q), checksLeft(userId)])
    return { ok: true, existing: (existing ?? []) as ExistingMatch[], candidates, checksLeft: left }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

const candidate = z.object({
  name: z.string().max(300),
  description: z.string().max(1000),
  image_url: z.string().url().max(2000).nullable(),
  price_low: z.number().nullable(),
  price_high: z.number().nullable(),
  count: z.number(),
  example_ids: z.array(z.string().max(100)).max(8),
})

/** Start researching a new product: uses one of today's free checks. */
export async function startResearch(rawQuery: string, rawCandidate: Candidate): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const q = query.parse(rawQuery)
    const card = candidate.parse(rawCandidate)
    const { userId } = await requireUser()
    const admin = createAdminClient()
    const { data: same } = await admin.from("research_products").select("id").eq("name", card.name).maybeSingle()
    if (same) {
      await admin.from("research_watch").upsert({ user_id: userId, product_id: same.id }, { onConflict: "user_id,product_id", ignoreDuplicates: true })
      revalidatePath("/research")
      return { ok: true, id: same.id }
    }
    const { data: allowed, error: limitError } = await admin.rpc("research_take_check", { _user: userId, _day: todayET(), _limit: DAILY_NEW_CHECKS })
    if (limitError) throw limitError
    if (!allowed) throw new UserError(`You've used today's ${DAILY_NEW_CHECKS} free item checks. Items others already track are still free to open.`)
    const profile = await buildProfile(q, card)
    const { data: product, error } = await admin.from("research_products")
      .insert({ query: q, name: profile.canonical_name || card.name, image_url: card.image_url, profile, created_by: userId })
      .select("id").single()
    if (error || !product) throw error ?? new Error("Couldn't save the product")
    await admin.from("research_watch").insert({ user_id: userId, product_id: product.id })
    await launchTrack(product.id)
    revalidatePath("/research")
    return { ok: true, id: product.id }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

async function launchTrack(productId: string) {
  const runId = await startRun(productId, "track")
  const run = await start(trackProduct, [productId, runId])
  await updateRun(runId, { workflow_run_id: run.runId })
  return runId
}

/** Refresh live listings now (free; skipped if refreshed in the last few hours or already running). */
export async function refreshResearch(productId: string): Promise<ActionResult> {
  try {
    const id = uuid.parse(productId)
    await requireUser()
    const admin = createAdminClient()
    const { data: running } = await admin.from("research_runs").select("id").eq("product_id", id).eq("kind", "track").eq("status", "running").maybeSingle()
    if (running) return { ok: true }
    const { data: p } = await admin.from("research_products").select("last_refresh_at").eq("id", id).single()
    if (p?.last_refresh_at && Date.now() - Date.parse(p.last_refresh_at) < REFRESH_MIN_HOURS * 3600_000)
      throw new UserError(`This item was refreshed in the last ${REFRESH_MIN_HOURS} hours. Live listings refresh again automatically every day.`)
    await launchTrack(id)
    revalidatePath(`/research/${id}`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/** Add a product others already research to your list (free). */
export async function watchResearch(productId: string): Promise<ActionResult> {
  try {
    const id = uuid.parse(productId)
    const { supabase, userId } = await requireUser()
    const { error } = await supabase.from("research_watch").upsert({ user_id: userId, product_id: id }, { onConflict: "user_id,product_id", ignoreDuplicates: true })
    if (error) throw error
    revalidatePath("/research")
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function unwatchResearch(productId: string): Promise<ActionResult> {
  try {
    const id = uuid.parse(productId)
    const { supabase } = await requireUser()
    const { error } = await supabase.from("research_watch").delete().eq("product_id", id)
    if (error) throw error
    revalidatePath("/research")
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

const cents = z.number().int().min(0).max(100_000_000).nullable()

/** Save your cost (and optional planned sale price) for the BUY/THIN/SKIP verdict. */
export async function setResearchPrices(productId: string, costCents: number | null, salePriceCents: number | null): Promise<ActionResult> {
  try {
    const id = uuid.parse(productId)
    const cost = cents.parse(costCents)
    const sale = cents.parse(salePriceCents)
    const { supabase, userId } = await requireUser()
    const { error } = await supabase.from("research_watch")
      .upsert({ user_id: userId, product_id: id, cost_cents: cost, sale_price_cents: sale }, { onConflict: "user_id,product_id" })
    if (error) throw error
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/** Bought it: create an inventory item at your cost, linked back to its research. */
export async function addResearchToInventory(productId: string, costCents: number, quantity: number): Promise<{ ok: true; itemId: string } | { ok: false; error: string }> {
  try {
    const id = uuid.parse(productId)
    const cost = z.number().int().min(0).max(100_000_000).parse(costCents)
    const qty = z.number().int().min(1).max(10_000).parse(quantity)
    const { supabase, userId } = await requireUser()
    const { data: product, error: pErr } = await supabase.from("research_products").select("name").eq("id", id).single()
    if (pErr || !product) throw new UserError("That research item no longer exists.")
    const { data: item, error } = await supabase.from("items")
      .insert({ title: product.name, status: "inventory", quantity: qty, cost_cents: cost, store: null })
      .select("id").single()
    if (error || !item) throw error ?? new Error("Couldn't add the item")
    await supabase.from("research_watch")
      .upsert({ user_id: userId, product_id: id, cost_cents: cost, item_id: item.id }, { onConflict: "user_id,product_id" })
    revalidatePath("/", "layout")
    return { ok: true, itemId: item.id }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

const soldRow = z.object({
  external_id: z.string().regex(/^\d{9,15}$/),
  title: z.string().min(1).max(300),
  sold_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  price: z.number().positive().max(1_000_000),
  shipping: z.number().min(0).max(100_000).nullable(),
  best_offer: z.boolean(),
  format: z.string().max(200).nullable(),
  condition: z.string().max(200).nullable(),
  seller: z.string().max(200).nullable(),
  variants_matched: z.array(z.string().max(200)).max(20),
})

/** Known sold listing IDs, so a refresh pull can stop early. */
export async function knownSoldIds(productId: string): Promise<string[]> {
  const id = uuid.parse(productId)
  const { supabase } = await requireUser()
  const { data } = await supabase.from("research_sales").select("external_id").eq("product_id", id).eq("source", "collector").order("sold_on", { ascending: false }).limit(2000)
  return (data ?? []).map((r) => r.external_id as string)
}

/** Save one batch of sold results read by the extension (the client sends batches under 1 MB). */
export async function uploadSoldRows(productId: string, rows: unknown[]): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  try {
    const id = uuid.parse(productId)
    const parsed = z.array(soldRow).max(800).parse(rows)
    await requireUser()
    const { added } = await saveSoldRows(id, parsed)
    return { ok: true, added }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

/** After all batches are saved: match them (AI + rules) and fetch units sold, in the background. */
export async function startSoldMatch(productId: string): Promise<ActionResult> {
  try {
    const id = uuid.parse(productId)
    await requireUser()
    const runId = await startRun(id, "sold")
    const run = await start(matchSoldHistory, [id, runId])
    await updateRun(runId, { workflow_run_id: run.runId })
    revalidatePath(`/research/${id}`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
