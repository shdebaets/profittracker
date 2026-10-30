import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { applySaleChecks, type SaleCheck, type SaleCheckOutcome } from "@/lib/crosslist/assisted-sales"
import { adapters, saleCheckStore } from "@/lib/crosslist/store"
import { reportError } from "@/lib/errors"
import { saleStatus } from "./sale-status"

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
const CONCURRENCY = 4

/**
 * The address to fetch for a saved Poshmark link, or null if it isn't one.
 * Links are typed by users, so never fetch anything but poshmark.com from the server.
 */
export function poshmarkUrl(link: string | null): string | null {
  try {
    const u = new URL(link ?? "")
    if (u.protocol !== "https:" || !["poshmark.com", "www.poshmark.com"].includes(u.hostname)) return null
    if (!/^\/listing\/[^/]*-[0-9a-f]{24}\/?$/.test(u.pathname)) return null
    return `https://poshmark.com${u.pathname}`
  } catch {
    return null
  }
}

/** Read each listing's public page. `blocked` counts pages we couldn't get or understand. */
export async function fetchSaleChecks(
  listings: { id: string; external_url: string | null }[],
  fetcher: typeof fetch = fetch,
): Promise<{ checks: SaleCheck[]; blocked: number }> {
  const checks: SaleCheck[] = []
  let blocked = 0
  const queue = [...listings]
  async function worker() {
    for (let l = queue.shift(); l; l = queue.shift()) {
      const url = poshmarkUrl(l.external_url)
      if (!url) continue
      try {
        const res = await fetcher(url, {
          headers: { "user-agent": USER_AGENT, accept: "text/html", "accept-language": "en-US" },
          signal: AbortSignal.timeout(10_000),
        })
        if (res.status === 404 || res.status === 410) {
          checks.push({ listingId: l.id, state: "unavailable", priceCents: null })
          continue
        }
        const status = res.ok ? saleStatus("poshmark", url, await res.text()) : null
        if (!status || status.state === "unknown") blocked++
        else checks.push({ listingId: l.id, ...status })
      } catch {
        blocked++
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return { checks, blocked }
}

/**
 * Check Poshmark listings not checked in the last `staleMs` and record what changed.
 * `db` decides whose: a user client sees that user's listings (RLS), the admin client everyone's.
 */
export async function checkPoshmarkListings(
  db: SupabaseClient,
  admin: SupabaseClient,
  { staleMs, limit }: { staleMs: number; limit: number },
): Promise<SaleCheckOutcome> {
  const cutoff = new Date(Date.now() - staleMs).toISOString()
  const { data: listings, error } = await db
    .from("marketplace_listings")
    .select("id, external_url")
    .eq("marketplace", "poshmark")
    .in("status", ["active", "delist_pending"])
    .not("external_url", "is", null)
    .or(`checked_at.is.null,checked_at.lt.${cutoff}`)
    .order("checked_at", { ascending: true, nullsFirst: true })
    .limit(limit)
  if (error) throw error
  if (!listings.length) return { sales: [], delisted: 0 }

  // Stamp first, so opening the app twice can't read the same pages twice.
  const { error: stampErr } = await db
    .from("marketplace_listings")
    .update({ checked_at: new Date().toISOString() })
    .in("id", listings.map((l) => l.id))
  if (stampErr) throw stampErr

  const { checks, blocked } = await fetchSaleChecks(listings)
  const out = await applySaleChecks(saleCheckStore(db, admin), adapters, checks)
  console.info(`poshmark check: ${listings.length} listings, ${out.sales.length} sold, ${out.delisted} delisted, ${blocked} blocked`)
  if (blocked && blocked === listings.length) reportError(new Error("Poshmark blocked every sale check"), "poshmark check")
  return out
}
