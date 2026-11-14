// Shared cache for Scan to Comp (comp_cache, service role only): eBay searches and AI answers.
import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"

export const LIVE_TTL_MS = 2 * 60 * 60_000 // live listings: 2 hours
export const IDENTIFY_TTL_MS = 24 * 60 * 60_000 // which products a search covers: a day

/** Returns the cached value if it's fresher than `ttlMs`, else runs `load` and stores it. */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const admin = createAdminClient()
  const { data } = await admin.from("comp_cache").select("payload, fetched_at").eq("key", key).maybeSingle()
  if (data && Date.now() - Date.parse(data.fetched_at) < ttlMs) return data.payload as T
  const value = await load()
  await admin.from("comp_cache").upsert({ key, payload: value, fetched_at: new Date().toISOString() }).then(
    ({ error }) => error && console.error("[comp cache] write failed", error),
  )
  return value
}
