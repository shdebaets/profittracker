"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { UserError } from "@/lib/errors"
import { planImport, type ImportCandidate, type ImportPlan } from "@/lib/import/plan"
import { fetchPoshmarkCloset, POSHMARK_PHOTO_HOST, PoshmarkClosetError, poshmarkUsername } from "@/lib/import/poshmark"
import { PHOTO_BUCKET } from "@/lib/photos"
import { requireCrosslister, requireUser } from "@/lib/supabase/server"
import { fail } from "./result"

type Result<T> = { ok: true; data: T } | { ok: false; error: string }
type SupabaseClient = Awaited<ReturnType<typeof requireUser>>["supabase"]

export type ImportPreview = { candidates: ImportCandidate[]; create: number; link: number; skip: number }

const MAX_IMPORT = 600
const PHOTO_CONCURRENCY = 6

// Candidates come back from the browser, so check them again: listing links must be the
// marketplace's own, and photos are only fetched from that marketplace's image hosts.
const LISTING_URL = {
  poshmark: /^https:\/\/poshmark\.com\/listing\/[^/?#]*-([0-9a-f]{24})$/,
  mercari: /^https:\/\/www\.mercari\.com\/(?:us\/)?item\/(m\d+)\/?$/,
}
const photoHostAllowed = (url: string) => {
  try {
    const u = new URL(url)
    return u.protocol === "https:" && (u.hostname === POSHMARK_PHOTO_HOST || u.hostname.endsWith(".mercdn.net"))
  } catch {
    return false
  }
}

const candidateSchema = z
  .object({
    marketplace: z.enum(["poshmark", "mercari"]),
    externalId: z.string().max(40),
    url: z.string().max(400),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000),
    priceCents: z.number().int().min(0).max(100_000_000).nullable(),
    brand: z.string().trim().max(100),
    size: z.string().trim().max(50),
    condition: z.enum(["new_with_tags", "new", "like_new", "good", "fair"]).nullable(),
    photoUrl: z.string().max(1000).nullable(),
  })
  .refine((c) => LISTING_URL[c.marketplace].exec(c.url)?.[1] === c.externalId, "Not a listing link")
  .transform((c) => ({ ...c, photoUrl: c.photoUrl && photoHostAllowed(c.photoUrl) ? c.photoUrl : null }))
const candidatesSchema = z.array(candidateSchema).max(MAX_IMPORT)

async function plan(supabase: SupabaseClient, candidates: ImportCandidate[]): Promise<ImportPlan> {
  const [items, listings] = await Promise.all([
    supabase.from("items").select("id, title, status").eq("status", "inventory"),
    supabase.from("marketplace_listings").select("item_id, marketplace, external_url").in("marketplace", ["poshmark", "mercari"]),
  ])
  if (items.error) throw items.error
  if (listings.error) throw listings.error
  return planImport(candidates, { items: items.data, listings: listings.data })
}

const preview = (candidates: ImportCandidate[], p: ImportPlan): ImportPreview => ({
  candidates, create: p.create.length, link: p.link.length, skip: p.skip.length,
})

/** Read a public Poshmark closet and say what importing it would do. Nothing is saved yet. */
export async function findPoshmarkListings(closet: string): Promise<Result<ImportPreview>> {
  try {
    const username = poshmarkUsername(closet)
    if (!username) throw new UserError("Enter your Poshmark username, or paste your closet link.")
    const { supabase } = await requireCrosslister()
    let candidates: ImportCandidate[]
    try {
      candidates = await fetchPoshmarkCloset(username)
    } catch (e) {
      if (e instanceof PoshmarkClosetError) {
        throw new UserError(
          e.reason === "not_found"
            ? `Couldn't find a Poshmark closet called "${username}". Check the spelling.`
            : "Poshmark didn't let FlipLedger read that closet just now. Try again in a few minutes.",
        )
      }
      throw e
    }
    if (!candidates.length) throw new UserError(`No live listings in ${username}'s closet.`)
    return { ok: true, data: preview(candidates, await plan(supabase, candidates)) }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

/** Say what importing listings found by the extension (Mercari) would do. Nothing is saved yet. */
export async function previewImport(input: ImportCandidate[]): Promise<Result<ImportPreview>> {
  try {
    const candidates = candidatesSchema.parse(input)
    if (!candidates.length) throw new UserError("No live listings found.")
    const { supabase } = await requireCrosslister()
    return { ok: true, data: preview(candidates, await plan(supabase, candidates)) }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

/** Copy a marketplace photo into the seller's own folder. Null if it can't be fetched. */
async function copyPhoto(supabase: SupabaseClient, userId: string, url: string | null): Promise<string | null> {
  if (!url) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    const type = res.headers.get("content-type") ?? ""
    if (!res.ok || !/^image\/(jpeg|png|webp)/.test(type)) return null
    const body = await res.arrayBuffer()
    if (body.byteLength > 10 * 1024 * 1024) return null
    const path = `${userId}/${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, body, { contentType: type.split(";")[0] })
    return error ? null : path
  } catch {
    return null
  }
}

/**
 * Import listings: new inventory items (cost unknown until the seller adds it) and
 * listings on items that already match. Re-plans on the server, so listings imported
 * since the preview are skipped rather than doubled.
 */
export async function importListings(input: ImportCandidate[]): Promise<Result<{ created: number; linked: number; skipped: number }>> {
  try {
    const candidates = candidatesSchema.parse(input)
    const { supabase, userId } = await requireCrosslister()
    const p = await plan(supabase, candidates)
    const now = new Date().toISOString()

    const photos: (string | null)[] = new Array(p.create.length).fill(null)
    const queue = p.create.map((c, i) => [c, i] as const)
    await Promise.all(
      Array.from({ length: PHOTO_CONCURRENCY }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) photos[next[1]] = await copyPhoto(supabase, userId, next[0].photoUrl)
      }),
    )

    const newItems = p.create.map((c, i) => ({
      id: crypto.randomUUID(),
      title: c.title,
      status: "inventory",
      quantity: 1,
      cost_cents: 0,
      cost_unknown: true,
      description: c.description || null,
      brand: c.brand || null,
      size: c.size || null,
      condition: c.condition,
      list_price_cents: c.priceCents,
      photo_paths: photos[i] ? [photos[i]] : [],
    }))
    if (newItems.length) {
      const { error } = await supabase.from("items").insert(newItems)
      if (error) throw error
    }

    const listing = (c: ImportCandidate, itemId: string) => ({
      item_id: itemId,
      marketplace: c.marketplace,
      status: "active",
      external_url: c.url,
      price_cents: c.priceCents,
      listed_at: now,
    })
    const rows = [...p.create.map((c, i) => listing(c, newItems[i].id)), ...p.link.map((l) => listing(l.candidate, l.itemId))]
    if (rows.length) {
      const { error } = await supabase.from("marketplace_listings").insert(rows)
      if (error) throw error
    }

    revalidatePath("/", "layout")
    return { ok: true, data: { created: p.create.length, linked: p.link.length, skipped: p.skip.length } }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}
