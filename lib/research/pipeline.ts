import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { judge, type JudgeRow } from "./ai"
import { median } from "./calc"
import { addDays, todayET } from "./days"
import {
  detailReader, EBAY_DAILY_BUDGET, ebayCallsToday, ebaySearch, ebayStatus, itemsByLegacyBatch, pool, sumPrice, sumShip, aspects,
  type GroupCache, type Summary,
} from "./ebay"
import { editionRule, guardSales, specificsVerdict, spreadUnits, countsSale } from "./metrics"
import { isPresale, matchExclusion, type Profile } from "./profile"
import { computeSummary } from "./summary"
import type { Listing, ResearchProduct, ResearchRun, RunProgress, Sale } from "./types"

// Database steps of the research pipeline. Each function does one bounded chunk of
// work so a Vercel Workflow step finishes well inside a function's time limit.

const db = () => createAdminClient()
const CONC = 6
const PAGE = 200
const MAX_OFFSET = 10_000
const JUDGE_BATCH = 60
const JUDGE_PARALLEL = 2
const DETAILS_PER_CHUNK = 36
/** Steady-state detail refreshes per product per day (new and repriced listings don't count). */
const DETAILS_ROTATION_CAP = 150
const DETAILS_MAX_AGE_DAYS = 3

export class BudgetError extends Error {
  constructor() {
    super("Paused: today's eBay API budget is nearly used. It continues tomorrow.")
  }
}

async function budgetLeft() {
  return EBAY_DAILY_BUDGET - (await ebayCallsToday())
}
/** Keep 5% of the shared daily quota free for searches and new products. */
async function requireBudget(calls: number) {
  if ((await budgetLeft()) < calls + Math.ceil(EBAY_DAILY_BUDGET * 0.05)) throw new BudgetError()
}

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

export async function getProduct(productId: string) {
  const { data, error } = await db().from("research_products").select("*").eq("id", productId).single()
  if (error || !data) throw new Error("Research product not found")
  return data as ResearchProduct
}

// ---------- runs ----------

export async function startRun(productId: string, kind: "track" | "sold") {
  await db().from("research_runs").update({ status: "superseded", updated_at: new Date().toISOString() })
    .eq("product_id", productId).eq("kind", kind).eq("status", "running")
  const { data, error } = await db().from("research_runs").insert({ product_id: productId, kind }).select("id").single()
  if (error || !data) throw new Error(error?.message ?? "Couldn't start research")
  if (kind === "track") await db().from("research_products").update({ last_status: "running", last_error: null }).eq("id", productId)
  return data.id as string
}

export async function runActive(runId: string) {
  const { data } = await db().from("research_runs").select("status").eq("id", runId).single()
  return data?.status === "running"
}

export async function updateRun(runId: string, patch: Partial<Pick<ResearchRun, "status" | "step" | "error" | "workflow_run_id">> & { progress?: RunProgress }) {
  const { data } = await db().from("research_runs").select("progress").eq("id", runId).single()
  await db().from("research_runs").update({
    ...patch,
    ...(patch.progress ? { progress: { ...(data?.progress ?? {}), ...patch.progress } } : {}),
    updated_at: new Date().toISOString(),
  }).eq("id", runId)
}

export async function finishRun(runId: string, productId: string, kind: "track" | "sold", status: "done" | "paused" | "error", message: string | null) {
  await updateRun(runId, { status, step: status === "done" ? "done" : undefined, error: message })
  await computeSummary(productId).catch((e) => console.error("research summary failed", e))
  if (kind === "track")
    await db().from("research_products").update({
      last_refresh_at: new Date().toISOString(),
      last_status: status === "error" ? "error" : "ok",
      last_error: message,
    }).eq("id", productId)
}

// ---------- search ----------

type Existing = Pick<Listing, "id" | "item_id" | "status" | "judged_by" | "matched_keywords" | "details_state" | "price" | "shipping">

/** Rule verdict for a title: exclusions, the single-edition rule, and a price sanity band. */
export function ruleVerdict(title: string, total: number, profile: Profile) {
  const edition = editionRule(title, profile)
  if (edition?.verdict === "reject") return { status: "rejected" as const, version_key: null, reason: edition.reason }
  const ex = matchExclusion(title, profile)
  if (ex) return { status: "rejected" as const, version_key: null, reason: `Rule: ${ex.label}` }
  const lo = Math.min(...profile.versions.map((v) => v.price_low ?? Infinity))
  const hi = Math.max(...profile.versions.map((v) => v.price_high ?? 0))
  if (Number.isFinite(lo) && hi > 0 && total > 0 && (total < lo * 0.35 || total > hi * 3))
    return { status: "rejected" as const, version_key: null, reason: `Rule: price $${total.toFixed(2)} far outside expected $${lo}–$${hi}` }
  if (edition?.verdict === "unknown_version") return { status: "counted" as const, version_key: "unknown_version", reason: edition.reason }
  return { status: "pending" as const, version_key: null, reason: null }
}

/** Every page of one keyword (up to eBay's 10,000-result cap), saved as it goes. */
export async function searchKeyword(productId: string, runId: string, keyword: string) {
  const product = await getProduct(productId)
  const profile = product.profile
  const today = todayET()
  const found = new Map<string, Summary>()
  let reported = 0
  let pages = 0
  for (let offset = 0; offset < MAX_OFFSET; offset += PAGE) {
    await requireBudget(1)
    const r = await ebaySearch(keyword, offset, PAGE)
    reported = r.total
    pages++
    for (const s of r.items) found.set(s.itemId, s)
    if (r.items.length < PAGE) break
  }
  // Existing rows for this product (by item id), fetched in pages of 300 ids.
  const existing = new Map<string, Existing>()
  const ids = [...found.keys()]
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await db().from("research_listings")
      .select("id,item_id,status,judged_by,matched_keywords,details_state,price,shipping")
      .eq("product_id", productId).in("item_id", ids.slice(i, i + 300))
    for (const r of (data ?? []) as Existing[]) existing.set(r.item_id, r)
  }
  const fresh: Record<string, unknown>[] = []
  const seen: Record<string, unknown>[] = []
  for (const s of found.values()) {
    const price = sumPrice(s) || null
    const shipping = sumShip(s)
    const old = existing.get(s.itemId)
    if (old) {
      const repriced = Number(old.price) !== Number(price) || Number(old.shipping) !== shipping
      const rule = old.judged_by === "user" ? null : ruleVerdict(s.title, (price ?? 0) + shipping, profile)
      seen.push({
        id: old.id, product_id: productId, item_id: s.itemId, title: s.title, price, shipping, live: true, last_seen: today,
        search_run_id: runId, matched_keywords: [...new Set([...(old.matched_keywords ?? []), keyword])],
        details_state: old.details_state === "unavailable" ? "unavailable" : repriced ? "pending" : old.details_state,
        // Machine decisions are rechecked by the rules; anything the rules don't settle keeps its AI verdict.
        ...(rule && rule.status !== "pending" ? { status: rule.status, version_key: rule.version_key, reason: rule.reason, judged_by: "rule" } : {}),
      })
      continue
    }
    const rule = ruleVerdict(s.title, (price ?? 0) + shipping, profile)
    fresh.push({
      product_id: productId, item_id: s.itemId, legacy_id: s.legacyItemId ?? s.itemId.split("|")[1] ?? null,
      title: s.title, price, shipping, currency: s.price?.currency ?? "USD", condition: s.condition ?? null,
      category: s.categories?.[0]?.categoryName ?? null, seller: s.seller?.username ?? null, seller_feedback: s.seller?.feedbackScore ?? null,
      buying_options: s.buyingOptions ?? [], image_url: s.image?.imageUrl ?? s.thumbnailImages?.[0]?.imageUrl ?? null,
      url: s.itemWebUrl ?? null, end_date: s.itemEndDate ?? null, start_date: s.itemCreationDate ?? null,
      presale: isPresale(s.title), best_offer: (s.buyingOptions ?? []).includes("BEST_OFFER"),
      status: rule.status, version_key: rule.version_key, reason: rule.reason, judged_by: rule.status === "pending" ? null : "rule",
      matched_keywords: [keyword], live: true, first_seen: today, last_seen: today, search_run_id: runId,
    })
  }
  for (let i = 0; i < fresh.length; i += 500) {
    const { error } = await db().from("research_listings").upsert(fresh.slice(i, i + 500), { onConflict: "product_id,item_id", ignoreDuplicates: true })
    if (error) throw new Error(`Saving listings: ${error.message}`)
  }
  for (let i = 0; i < seen.length; i += 500) {
    const { error } = await db().from("research_listings").upsert(seen.slice(i, i + 500), { onConflict: "id" })
    if (error) throw new Error(`Updating listings: ${error.message}`)
  }
  return { keyword, reported, pages, unique: found.size }
}

/** After every keyword is searched: listings this run didn't see have ended. */
export async function finishSearch(productId: string, runId: string) {
  const today = todayET()
  const gone = await all<Pick<Listing, "id" | "status" | "end_date" | "avail_qty" | "sold_qty" | "version_key" | "price" | "shipping" | "title">>((a, b) =>
    db().from("research_listings").select("id,status,end_date,avail_qty,sold_qty,version_key,price,shipping,title")
      .eq("product_id", productId).eq("live", true).or(`search_run_id.is.null,search_run_id.neq.${runId}`).order("id").range(a, b),
  )
  for (let i = 0; i < gone.length; i += 300)
    await db().from("research_listings").update({ live: false }).in("id", gone.slice(i, i + 300).map((g) => g.id))
  // A single-unit counted listing that vanished before its end date most likely sold.
  const sales = gone
    .filter((r) => r.status === "counted" && (!r.end_date || new Date(r.end_date) > new Date()) && Number(r.avail_qty ?? 1) <= 1 && Number(r.sold_qty ?? 0) === 0)
    .map((r) => ({
      product_id: productId, external_id: `tracker:${r.id}`, listing_id: r.id, source: "tracker", verdict: r.version_key ?? "unknown_version",
      version_key: r.version_key, sold_on: today, price: Number(r.price ?? 0) + Number(r.shipping ?? 0), qty: 1, units: 1, title: r.title,
    }))
  if (sales.length) await db().from("research_sales").upsert(sales, { onConflict: "product_id,source,external_id", ignoreDuplicates: true })
  const { count } = await db().from("research_listings").select("id", { count: "exact", head: true }).eq("product_id", productId).eq("status", "pending")
  return count ?? 0
}

// ---------- judge ----------

/** Judge up to 120 pending listings. Returns how many are still pending. */
export async function judgeListings(productId: string) {
  const product = await getProduct(productId)
  const profile = product.profile
  const keys = new Set(profile.versions.map((v) => v.key))
  const { data } = await db().from("research_listings").select("id,item_id,title,price,shipping,condition,category,judge_attempts")
    .eq("product_id", productId).eq("status", "pending").order("id").limit(JUDGE_BATCH * JUDGE_PARALLEL)
  const rows = (data ?? []) as Pick<Listing, "id" | "item_id" | "title" | "price" | "shipping" | "condition" | "category" | "judge_attempts">[]
  if (!rows.length) return 0
  const batches: (typeof rows)[] = []
  for (let i = 0; i < rows.length; i += JUDGE_BATCH) batches.push(rows.slice(i, i + JUDGE_BATCH))
  await pool(batches, JUDGE_PARALLEL, async (batch) => {
    const input: JudgeRow[] = batch.map((b) => ({
      id: b.id, t: b.title, p: Number((Number(b.price ?? 0) + Number(b.shipping ?? 0)).toFixed(2)), cond: b.condition, cat: b.category,
    }))
    let results: Awaited<ReturnType<typeof judge>> = []
    try {
      results = await judge(profile, product.examples ?? [], input)
    } catch (e) {
      console.error("research judge batch failed", e)
    }
    const by = new Map(results.map((r) => [r.id, r]))
    const ups = batch.map((b) => {
      const r = by.get(b.id)
      if (!r) {
        const attempts = b.judge_attempts + 1
        return attempts >= 2
          ? { id: b.id, status: "review", reason: "AI couldn't read this one, please review", judge_attempts: attempts, judged_by: "ai" }
          : { id: b.id, judge_attempts: attempts }
      }
      const counted = keys.has(r.v) || r.v === "unknown_version"
      return {
        id: b.id, judged_by: "ai", confidence: r.c, details_state: "pending",
        status: counted ? "counted" : r.v === "reject" ? "rejected" : "review",
        version_key: counted ? r.v : null,
        reason: r.v === "unknown_version" ? `Unknown version: ${r.r}` : r.r,
      }
    })
    for (const u of ups) await db().from("research_listings").update(u).eq("id", u.id)
  })
  const { count } = await db().from("research_listings").select("id", { count: "exact", head: true }).eq("product_id", productId).eq("status", "pending")
  return count ?? 0
}

/** Live listings far from their version's median price go to review. */
export async function priceGuard(productId: string) {
  const rows = await all<Pick<Listing, "id" | "version_key" | "price" | "shipping">>((a, b) =>
    db().from("research_listings").select("id,version_key,price,shipping").eq("product_id", productId).eq("status", "counted").eq("live", true).order("id").range(a, b),
  )
  const byVersion = new Map<string, { id: string; t: number }[]>()
  for (const r of rows) {
    const t = Number(r.price ?? 0) + Number(r.shipping ?? 0)
    if (!r.version_key || !t) continue
    byVersion.set(r.version_key, [...(byVersion.get(r.version_key) ?? []), { id: r.id, t }])
  }
  for (const list of byVersion.values()) {
    const med = median(list.map((x) => x.t))
    if (!med || list.length < 4) continue
    const out = list.filter((x) => x.t < med * 0.55 || x.t > med * 1.9)
    await pool(out, CONC, async (x) => {
      await db().from("research_listings").update({ status: "review", reason: `Price guard: $${x.t.toFixed(2)} vs median $${med.toFixed(2)}` }).eq("id", x.id)
    })
  }
}

// ---------- listing details ----------

/** Which counted live listings need details today: new or repriced first, then a capped 3-day rotation. */
export function detailsTodo(rows: Pick<Listing, "id" | "details_state" | "details_fetched_at" | "price" | "shipping">[], fetchedToday: number, now = new Date()) {
  const stale = now.getTime() - DETAILS_MAX_AGE_DAYS * 864e5
  const cheapest = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    Number(a.price ?? 0) + Number(a.shipping ?? 0) - Number(b.price ?? 0) - Number(b.shipping ?? 0)
  const urgent = rows.filter((r) => r.details_state === "pending").sort(cheapest)
  const rotation = rows
    .filter((r) => r.details_state === "available" && (!r.details_fetched_at || Date.parse(r.details_fetched_at) < stale))
    .sort((a, b) => Date.parse(a.details_fetched_at ?? "1970-01-01") - Date.parse(b.details_fetched_at ?? "1970-01-01"))
    .slice(0, Math.max(0, DETAILS_ROTATION_CAP - fetchedToday))
  return [...urgent, ...rotation]
}

/** Fetch details for one chunk of listings. Returns how many are left today. */
export async function detailsChunk(productId: string) {
  const product = await getProduct(productId)
  const profile = product.profile
  const today = todayET()
  const rows = await all<Listing>((a, b) =>
    db().from("research_listings").select("*").eq("product_id", productId).eq("status", "counted").eq("live", true).order("id").range(a, b),
  )
  const startOfDay = new Date(`${today}T05:00:00Z`).toISOString()
  const fetchedToday = rows.filter((r) => r.details_fetched_at && r.details_fetched_at >= startOfDay && r.details_state === "available").length
  const todo = detailsTodo(rows, fetchedToday)
  if (!todo.length) return { left: 0, total: rows.length }
  const chunk = todo.slice(0, DETAILS_PER_CHUNK).map((t) => rows.find((r) => r.id === t.id)!)
  await requireBudget(Math.ceil(chunk.length / 20) + 4)
  const cache: GroupCache = {}
  const prefetched = await itemsByLegacyBatch(chunk.map((r) => r.legacy_id).filter((id): id is string => !!id))
  const read = detailReader(profile, cache, prefetched)
  const failures: string[] = []
  const sales: Record<string, unknown>[] = []
  await pool(chunk, CONC, async (r) => {
    const patch: Record<string, unknown> = { details_fetched_at: new Date().toISOString() }
    try {
      if (!r.legacy_id) throw Object.assign(new Error("Listing ID unavailable"), { status: 404 })
      const { detail: d, reason: groupReason } = await read(r.legacy_id, r.version_key ?? "unknown_version")
      const ea = d.estimatedAvailabilities?.[0] ?? {}
      const sold = ea.estimatedSoldQuantity ?? r.sold_qty
      const specifics = aspects(d)
      Object.assign(patch, {
        details_state: "available",
        price: d.price?.value ? Number(d.price.value) : r.price,
        sold_qty: sold,
        avail_qty: ea.estimatedAvailableQuantity ?? r.avail_qty,
        specifics,
        image_url: d.image?.imageUrl ?? r.image_url,
        start_date: d.itemCreationDate ?? r.start_date,
        end_date: d.itemEndDate ?? r.end_date,
        ...(groupReason ? { reason: groupReason } : {}),
      })
      const cross = specificsVerdict(specifics, r.version_key ?? "unknown_version", profile)
      if (cross && r.judged_by !== "user") {
        if (cross.verdict === "review") Object.assign(patch, { status: "review", reason: cross.reason })
        else Object.assign(patch, { version_key: cross.verdict, reason: cross.reason })
      }
      if (r.sold_qty != null && sold != null && sold > r.sold_qty)
        sales.push({
          product_id: productId, external_id: `tracker:${r.id}:${today}`, listing_id: r.id, source: "tracker",
          verdict: r.version_key ?? "unknown_version", version_key: r.version_key, sold_on: today,
          price: Number(r.price ?? 0) + Number(r.shipping ?? 0), qty: sold - r.sold_qty, units: sold - r.sold_qty, title: r.title, url: r.url,
        })
    } catch (e) {
      const status = ebayStatus(e) || Number((e as { status?: number }).status ?? 0)
      if ([401, 403, 429].includes(status) || !status) {
        failures.push((e as Error).message)
        return
      }
      Object.assign(patch, { details_state: "unavailable", reason: `Listing details unavailable (${status})` })
    }
    await db().from("research_listings").update(patch).eq("id", r.id)
    if (patch.details_state === "available")
      await db().from("research_snapshots").upsert({
        listing_id: r.id, product_id: productId, day: today, price: patch.price as number | null, shipping: r.shipping,
        sold_qty: patch.sold_qty as number | null, avail_qty: patch.avail_qty as number | null,
      }, { onConflict: "listing_id,day" })
  })
  if (sales.length) await db().from("research_sales").upsert(sales, { onConflict: "product_id,source,external_id", ignoreDuplicates: true })
  if (failures.length) throw new Error(`${failures.length} detail calls failed; they'll be retried. ${failures[0]}`)
  return { left: Math.max(0, todo.length - chunk.length), total: rows.length }
}

// ---------- sold history (rows collected by the browser extension) ----------

export type SoldUploadRow = {
  external_id: string
  title: string
  sold_on: string
  price: number
  shipping: number | null
  best_offer: boolean
  format: string | null
  condition: string | null
  seller: string | null
  variants_matched: string[]
}

/** Save collected sold results (deduplicated by eBay listing ID). Returns how many were new. */
export async function saveSoldRows(productId: string, rows: SoldUploadRow[]) {
  const product = await getProduct(productId)
  const profile = product.profile
  const unique = [...new Map(rows.map((r) => [r.external_id, r])).values()]
  const existing = new Map<string, Pick<Sale, "id" | "sold_on" | "variants_matched">>()
  const ids = unique.map((r) => r.external_id)
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await db().from("research_sales").select("id,external_id,sold_on,variants_matched")
      .eq("product_id", productId).eq("source", "collector").in("external_id", ids.slice(i, i + 300))
    for (const r of (data ?? []) as (Pick<Sale, "id" | "sold_on" | "variants_matched"> & { external_id: string })[]) existing.set(r.external_id, r)
  }
  const inserts: Record<string, unknown>[] = []
  for (const row of unique) {
    const variants = row.variants_matched.filter((k) => profile.keywords.includes(k))
    const old = existing.get(row.external_id)
    if (old) {
      const newer = row.sold_on > old.sold_on
      await db().from("research_sales").update({
        variants_matched: [...new Set([...(old.variants_matched ?? []), ...variants])],
        collected_at: new Date().toISOString(),
        ...(newer ? { sold_on: row.sold_on, price: row.price, shipping: row.shipping, best_offer: row.best_offer, details_state: "pending" } : {}),
      }).eq("id", old.id)
      continue
    }
    const rule = ruleVerdict(row.title, row.price, profile)
    inserts.push({
      ...row, variants_matched: variants, product_id: productId, source: "collector", url: `https://www.ebay.com/itm/${row.external_id}`,
      presale: isPresale(row.title), qty: 1, units: 1, collected_at: new Date().toISOString(),
      verdict: rule.status === "rejected" ? "reject" : rule.version_key ?? "pending", reason: rule.reason,
      version_key: rule.version_key === "unknown_version" ? null : rule.version_key,
    })
  }
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await db().from("research_sales").insert(inserts.slice(i, i + 500))
    if (error) throw new Error(error.message)
  }
  await db().from("research_products").update({ sold_collected_at: new Date().toISOString() }).eq("id", productId)
  return { pulled: unique.length, added: inserts.length }
}

async function collectorSales(productId: string) {
  return all<Sale>((a, b) => db().from("research_sales").select("*").eq("product_id", productId).eq("source", "collector").order("id").range(a, b))
}

export async function soldJudgeChunk(productId: string) {
  const product = await getProduct(productId)
  const profile = product.profile
  const keys = new Set([...profile.versions.map((v) => v.key), "unknown_version", "reject", "review"])
  const { data } = await db().from("research_sales").select("id,title,price,condition,judge_attempts")
    .eq("product_id", productId).eq("source", "collector").eq("verdict", "pending").order("id").limit(JUDGE_BATCH * JUDGE_PARALLEL)
  const rows = (data ?? []) as Pick<Sale, "id" | "title" | "price" | "condition" | "judge_attempts">[]
  if (!rows.length) return 0
  const batches: (typeof rows)[] = []
  for (let i = 0; i < rows.length; i += JUDGE_BATCH) batches.push(rows.slice(i, i + JUDGE_BATCH))
  await pool(batches, JUDGE_PARALLEL, async (batch) => {
    let results: Awaited<ReturnType<typeof judge>> = []
    try {
      results = await judge(profile, product.examples ?? [], batch.map((s) => ({ id: String(s.id), t: s.title ?? "", p: Number(s.price), cond: s.condition, cat: profile.category ?? null })))
    } catch (e) {
      console.error("research sold judge batch failed", e)
    }
    const by = new Map(results.map((r) => [r.id, r]))
    for (const s of batch) {
      const r = by.get(String(s.id))
      const patch = r && keys.has(r.v)
        ? { verdict: r.v, version_key: ["reject", "review", "unknown_version"].includes(r.v) ? null : r.v, reason: r.r }
        : s.judge_attempts + 1 >= 2
          ? { verdict: "review", reason: "AI couldn't read this one, please review", judge_attempts: s.judge_attempts + 1 }
          : { judge_attempts: s.judge_attempts + 1 }
      await db().from("research_sales").update(patch).eq("id", s.id)
    }
  })
  const { count } = await db().from("research_sales").select("id", { count: "exact", head: true })
    .eq("product_id", productId).eq("source", "collector").eq("verdict", "pending")
  return count ?? 0
}

export async function soldGuard(productId: string) {
  const product = await getProduct(productId)
  const changes = guardSales(await collectorSales(productId), product.profile)
  await pool(changes, CONC, async (c) => {
    await db().from("research_sales").update({ verdict: c.verdict, reason: c.reason }).eq("id", c.id)
  })
}

/** Details for counted sold listings (fetched once each): units sold and item specifics. */
export async function soldDetailsChunk(productId: string) {
  const product = await getProduct(productId)
  const profile = product.profile
  const todo = (await collectorSales(productId)).filter((s) => countsSale(s) && s.details_state === "pending")
  if (!todo.length) return 0
  const chunk = todo.slice(0, 40)
  await requireBudget(Math.ceil(chunk.length / 20) + 4)
  const read = detailReader(profile, {}, await itemsByLegacyBatch(chunk.map((s) => s.external_id)))
  const failures: string[] = []
  await pool(chunk, CONC, async (s) => {
    try {
      const { detail, reason } = await read(s.external_id, s.version_key ?? s.verdict ?? "unknown_version")
      const sp = aspects(detail)
      const created = detail.itemCreationDate ?? null
      const allocation = spreadUnits(detail.estimatedAvailabilities?.[0]?.estimatedSoldQuantity, created, s.sold_on, profile.release_date)
      const cross = s.human_decision ? null : specificsVerdict(sp, s.verdict ?? "unknown_version", profile)
      await db().from("research_sales").update({
        specifics: sp, listing_created_at: created, details_state: "available", units: allocation.units, qty: allocation.units,
        volume_days: allocation.days, ...(reason ? { reason } : {}),
        ...(cross ? { verdict: cross.verdict, version_key: cross.verdict === "review" ? s.version_key : cross.verdict, reason: cross.reason } : {}),
      }).eq("id", s.id)
    } catch (e) {
      const status = ebayStatus(e)
      if ([401, 403, 429].includes(status) || !status) {
        failures.push((e as Error).message)
        return
      }
      await db().from("research_sales").update({ details_state: "unavailable", reason: `Listing details unavailable (${status})` }).eq("id", s.id)
    }
  })
  if (failures.length) throw new Error(`${failures.length} detail calls failed; they'll be retried. ${failures[0]}`)
  return Math.max(0, todo.length - chunk.length)
}

export async function soldSummary(productId: string): Promise<RunProgress> {
  const rows = await collectorSales(productId)
  return {
    pulled: rows.length,
    judged: rows.filter((s) => s.verdict !== "pending").length,
    counted: rows.filter(countsSale).length,
    review: rows.filter((s) => s.verdict === "review").length,
    rejected: rows.filter((s) => s.verdict === "reject").length,
    details: { done: rows.filter((s) => s.details_state !== "pending").length, total: rows.length },
  }
}

/** Products due for the daily refresh: active, watched by someone, not refreshed today. */
export async function dueProducts(limit = 25) {
  const { data: watched } = await db().from("research_watch").select("product_id")
  const ids = [...new Set((watched ?? []).map((w) => w.product_id as string))]
  if (!ids.length) return []
  const { data } = await db().from("research_products").select("id,last_refresh_at").eq("status", "active").in("id", ids)
  const today = todayET()
  const yesterday = addDays(today, -1)
  return (data ?? [])
    .filter((p) => !p.last_refresh_at || p.last_refresh_at.slice(0, 10) <= yesterday)
    .slice(0, limit)
    .map((p) => p.id as string)
}
