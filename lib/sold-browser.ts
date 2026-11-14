"use client"

// Where sold prices come from on this device, cheapest first:
//   1. The Chrome extension (desktop): reads eBay's sold search in the member's own signed-in Chrome.
//   2. The phone app: reads it in the app's own eBay window (lib/native-ebay.ts).
//   3. Neither: the server's paid data provider (lib/comps/sold-api.ts).
// 1 and 2 cost nothing: one eBay page (up to 240 sales) per product, at most every 12 hours,
// shared with everyone.

import { saveSoldComps } from "@/app/(app)/actions/comps"
import type { CollectedSold } from "@/lib/comps/collect-sold"
import { soldPhrase } from "@/lib/comps/stats"
import { collectSoldWithExtension, extensionCanCollectComps } from "@/lib/extension"
import { inPhoneApp, readSoldInApp } from "@/lib/native-ebay"

export type SoldSource = "extension" | "app" | null

/**
 * Off: Nick wants one source for every member, the paid provider, so numbers don't change
 * depending on who has the extension (mixing reads made counts jump: 0, then 200, then 30).
 * Flip to true to let the extension and phone app read eBay again.
 */
export const BROWSER_SOLD_READS = false

export function soldSource(extensionReady: boolean): SoldSource {
  if (!BROWSER_SOLD_READS) return null
  if (inPhoneApp()) return "app"
  if (extensionReady && extensionCanCollectComps()) return "extension"
  return null
}

/**
 * Reads eBay's sold listings for each search (one eBay page each, up to 240 sales) in this
 * browser, merges them by listing id and saves them under `query`. The AI judge on the server then
 * drops the look-alikes the wider searches bring in.
 */
export async function pullSoldHere(
  source: Exclude<SoldSource, null>,
  query: string,
  searches?: string[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const phrases = searches?.length ? searches : [soldPhrase(query)]
  const rows = new Map<string, CollectedSold>()
  let total: number | null = null
  let firstError: string | null = null
  for (const phrase of phrases) {
    const res = source === "app" ? await readSoldInApp(phrase) : await collectSoldWithExtension(query, phrase)
    if (!res.ok) {
      firstError ??= res.error
      // Signed out or a captcha won't clear by trying the next search.
      if (rows.size === 0) break
      continue
    }
    for (const r of res.rows) rows.set(r.external_id, r)
    if (res.total != null) total = Math.max(total ?? 0, res.total)
  }
  if (!rows.size && firstError) return { ok: false, error: firstError }
  const saved = await saveSoldComps(query, [...rows.values()], total)
  if (!saved.ok) return { ok: false, error: saved.error }
  return { ok: true, count: rows.size }
}

/** Stale = never read, or read over 12 hours ago (same window as the paid provider). */
export const soldIsStale = (collectedAt: string | null) => !collectedAt || Date.now() - Date.parse(collectedAt) > 12 * 3_600_000
