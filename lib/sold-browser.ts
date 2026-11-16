"use client"

// Where sold prices come from on this device, cheapest first:
//   1. The Chrome extension (desktop): reads eBay's sold search in the member's own signed-in Chrome.
//   2. The phone app: reads it in the app's own eBay window (lib/native-ebay.ts).
//   3. Neither: the server's paid data provider (lib/comps/sold-api.ts).
// 1 and 2 cost nothing and are shared with everyone: every keyword in the product's profile, 240
// sales a page, at most every 12 hours per product.

import { saveSoldComps } from "@/app/(app)/actions/comps"
import type { CollectedSold } from "@/lib/comps/collect-sold"
import { soldPhrase } from "@/lib/comps/stats"
import { collectSoldWithExtension, extensionCanCollectComps, extensionCanPageComps } from "@/lib/extension"
import { inPhoneApp, readSoldInApp } from "@/lib/native-ebay"

export type SoldSource = "extension" | "app" | null

/**
 * On (Nov 15 2026, Nick): the extension or phone app reads eBay first, the paid provider fills in
 * for everyone else. Both write the same comp_sales rows (one per listing) and units come from the
 * Browse API either way, so counts no longer depend on who read last.
 */
export const BROWSER_SOLD_READS = true

export function soldSource(extensionReady: boolean): SoldSource {
  if (!BROWSER_SOLD_READS) return null
  if (inPhoneApp()) return "app"
  if (extensionReady && extensionCanCollectComps()) return "extension"
  return null
}

/** Pages read per keyword: deeper the first time a product is read (busy products need it). */
const pagesFor = (n: number, deep: boolean) => (deep ? (n === 0 ? 10 : 4) : 2)
/** Rows saved per server action call (actions cap bodies at 1MB). */
const SAVE_BATCH = 1500

/**
 * Reads eBay's sold listings for each keyword in this browser, paging while a page is full and
 * still finds new sales, merges them by listing id and saves them under `query`. The AI judge on
 * the server then drops the look-alikes the wider searches bring in.
 */
export async function pullSoldHere(
  source: Exclude<SoldSource, null>,
  query: string,
  searches?: string[],
  /** Never read before (or over a day ago): page deeper. */
  deep = false,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const phrases = searches?.length ? searches : [soldPhrase(query)]
  const rows = new Map<string, CollectedSold>()
  let total: number | null = null
  let firstError: string | null = null
  const canPage = source === "extension" && extensionCanPageComps()
  outer: for (const [n, phrase] of phrases.entries()) {
    for (let page = 1; page <= (canPage ? pagesFor(n, deep) : 1); page++) {
      const res = source === "app" ? await readSoldInApp(phrase) : await collectSoldWithExtension(query, phrase, page)
      if (!res.ok) {
        firstError ??= res.error
        // Signed out or a captcha won't clear by trying the next search.
        if (rows.size === 0) break outer
        continue outer
      }
      const before = rows.size
      for (const r of res.rows as CollectedSold[]) rows.set(r.external_id, r)
      if (res.total != null && page === 1) total = Math.max(total ?? 0, res.total)
      const cards = "cards" in res ? res.cards : null
      // eBay's last page, or nothing new (the other keywords already found these).
      if ((cards ?? res.rows.length) < 200 || rows.size === before) break
    }
  }
  if (!rows.size && firstError) return { ok: false, error: firstError }
  const all = [...rows.values()]
  // One read: every batch shares its timestamp, so the stats can pick out this read's rows.
  const readAt = new Date().toISOString()
  for (let i = 0; i < Math.max(all.length, 1); i += SAVE_BATCH) {
    const saved = await saveSoldComps(query, all.slice(i, i + SAVE_BATCH), total, readAt)
    if (!saved.ok) return { ok: false, error: saved.error }
  }
  return { ok: true, count: rows.size }
}

/** Stale = never read, or read over 12 hours ago (same window as the paid provider). */
export const soldIsStale = (collectedAt: string | null) => !collectedAt || Date.now() - Date.parse(collectedAt) > 12 * 3_600_000
