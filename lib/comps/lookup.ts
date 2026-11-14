import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { searchActive } from "./ebay-browse"
import { compStats, isGtin, queryKey, type CompStats, type SoldComp } from "./stats"

export type CompLookup = {
  /** What sold history is filed under (and what the extension searches eBay for). */
  query: string
  gtin: string | null
  title: string | null
  image: string | null
  stats: CompStats
  soldCollectedAt: string | null
}

/** A product title trimmed to the words that matter for a search. */
export const searchPhrase = (title: string) =>
  title.replace(/\b(new|sealed|brand|free shipping|fast|nib|nwt|authentic|look|rare|l@@k)\b/gi, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 8).join(" ")

export async function lookupComps(supabase: SupabaseClient, input: string, now = new Date()): Promise<CompLookup> {
  const raw = input.trim()
  const gtin = isGtin(raw) ? raw : null
  const live = await searchActive(gtin ? { gtin } : { q: raw })
  const query = gtin ? (live.title ? searchPhrase(live.title) : raw) : raw
  const since = new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10)
  const { data } = await supabase
    .from("comp_sales")
    .select("price_cents, shipping_cents, sold_on, best_offer, collected_at")
    .eq("query_key", queryKey(query))
    .gte("sold_on", since)
    .limit(1000)
  const rows = data ?? []
  const sold: SoldComp[] = rows.map((r) => ({ priceCents: r.price_cents, shippingCents: r.shipping_cents, soldOn: r.sold_on, bestOffer: r.best_offer }))
  const latest = rows.reduce<string | null>((m, r) => (!m || r.collected_at > m ? r.collected_at : m), null)
  return { query, gtin, title: live.title, image: live.image, stats: compStats(live.comps, sold, now), soldCollectedAt: latest }
}
