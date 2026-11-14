"use client"

// Where sold prices come from on this device, cheapest first:
//   1. The Chrome extension (desktop): reads eBay's sold search in the member's own signed-in Chrome.
//   2. The phone app: reads it in the app's own eBay window (lib/native-ebay.ts).
//   3. Neither: the server's paid data provider (lib/comps/sold-api.ts).
// 1 and 2 cost nothing: one eBay page (up to 240 sales) per product, at most every 12 hours,
// shared with everyone.

import { saveSoldComps } from "@/app/(app)/actions/comps"
import { soldPhrase } from "@/lib/comps/stats"
import { collectSoldWithExtension, extensionCanCollectComps } from "@/lib/extension"
import { inPhoneApp, readSoldInApp } from "@/lib/native-ebay"

export type SoldSource = "extension" | "app" | null

export function soldSource(extensionReady: boolean): SoldSource {
  if (inPhoneApp()) return "app"
  if (extensionReady && extensionCanCollectComps()) return "extension"
  return null
}

/** Reads eBay's sold listings for `query` in this browser and saves them. */
export async function pullSoldHere(source: Exclude<SoldSource, null>, query: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const phrase = soldPhrase(query)
  const res = source === "app" ? await readSoldInApp(phrase) : await collectSoldWithExtension(query, phrase)
  if (!res.ok) return res
  const saved = await saveSoldComps(query, res.rows, res.total ?? null)
  if (!saved.ok) return { ok: false, error: saved.error }
  return { ok: true, count: res.rows.length }
}

/** Stale = never read, or read over 12 hours ago (same window as the paid provider). */
export const soldIsStale = (collectedAt: string | null) => !collectedAt || Date.now() - Date.parse(collectedAt) > 12 * 3_600_000
