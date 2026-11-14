// Overpriced alerts need sold prices on file. Once a day (from /api/cron/alerts) this reads sold
// listings for the products sellers have live listings for but nobody has comped lately, oldest
// first, through the same paid provider Scan to Comp uses (refreshSoldFromApi, which keeps its own
// 12-hour marker and daily request cap). It uses at most half of the day's provider requests, so
// sellers scanning in the app always have budget left.
import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { searchPhrase } from "@/lib/comps/lookup"
import { refreshSoldFromApi, soldKey } from "@/lib/comps/sold-api"
import { queryKey } from "@/lib/comps/stats"

/** Sold prices younger than this count as fresh enough for an overpriced check. */
export const FRESH_DAYS = 7
/** Products read per run; override with OVERPRICED_PREFETCH_LIMIT. */
export const DEFAULT_PREFETCH_LIMIT = 10
/** Share of the provider's daily cap (SOLD_DATA_DAILY_LIMIT) this job may use. */
export const PREFETCH_SHARE = 0.5

export type PrefetchCandidate = { query: string; lastReadAt: string | null }

/** Which searches to read: not read in FRESH_DAYS, never-read first, then oldest. Pure. */
export function pickStale(titles: string[], lastRead: Map<string, string>, now: Date, limit: number): PrefetchCandidate[] {
  const byKey = new Map<string, string>()
  for (const t of titles) {
    const q = searchPhrase(t)
    if (q.length >= 3 && !byKey.has(queryKey(q))) byKey.set(queryKey(q), q)
  }
  const cutoff = now.getTime() - FRESH_DAYS * 86_400_000
  return [...byKey.values()]
    .map((query) => ({ query, lastReadAt: lastRead.get(soldKey(query)) ?? null }))
    .filter((c) => !c.lastReadAt || Date.parse(c.lastReadAt) < cutoff)
    .sort((a, b) => (a.lastReadAt ?? "").localeCompare(b.lastReadAt ?? ""))
    .slice(0, limit)
}

async function requestsToday(admin: SupabaseClient) {
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const { data } = await admin.from("comp_cache").select("payload").like("key", "sold%").gte("fetched_at", since).limit(5000)
  return (data ?? []).reduce((n, r) => n + (Number((r.payload as { requests?: number })?.requests) || 1), 0)
}

export async function prefetchListedComps(admin: SupabaseClient, now = new Date()) {
  if (!process.env.SOLD_DATA_API_KEY?.trim()) return { checked: 0, read: 0, saved: 0, skipped: "no SOLD_DATA_API_KEY" }
  const limit = Number(process.env.OVERPRICED_PREFETCH_LIMIT) || DEFAULT_PREFETCH_LIMIT
  const budget = Math.floor((Number(process.env.SOLD_DATA_DAILY_LIMIT) || 300) * PREFETCH_SHARE)

  // Unsold items with at least one live listing, across all sellers (titles only).
  const { data, error } = await admin
    .from("items")
    .select("title, marketplace_listings!inner(status)")
    .eq("status", "inventory")
    .eq("marketplace_listings.status", "active")
    .not("title", "is", null)
    .limit(5000)
  if (error) throw error
  const titles = (data ?? []).map((r) => r.title as string)

  const keys = [...new Set(titles.map((t) => soldKey(searchPhrase(t))))]
  const lastRead = new Map<string, string>()
  for (let i = 0; i < keys.length; i += 200) {
    const { data: rows } = await admin.from("comp_cache").select("key, fetched_at").in("key", keys.slice(i, i + 200))
    for (const r of rows ?? []) lastRead.set(r.key, r.fetched_at)
  }

  const picks = pickStale(titles, lastRead, now, limit)
  let read = 0, saved = 0
  for (const p of picks) {
    if ((await requestsToday(admin)) >= budget) break
    // The AI's extra searches for this product when Scan to Comp already worked them out.
    const { data: v } = await admin.from("comp_cache").select("payload").eq("key", `var:${queryKey(p.query)}`).maybeSingle()
    const searches = Array.isArray(v?.payload) ? (v.payload as string[]).filter((s) => typeof s === "string") : undefined
    saved += await refreshSoldFromApi(p.query, searches)
    read++
  }
  return { checked: keys.length, read, saved }
}
