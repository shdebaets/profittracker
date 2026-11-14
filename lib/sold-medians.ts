// Recent sold medians for inventory items, from the shared comp_sales on file for each title
// (last 90 days, AI-judged so cases and lots don't drag it down). Used for the reprice panel's
// "Suggested" price, the overpriced check in the weekly alert, and the overpriced prefetch.
// Same rules as findOverpriced in app/(app)/actions/comps.ts.
import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { judgeTitles } from "@/lib/comps/judge"
import { searchPhrase } from "@/lib/comps/lookup"
import { median, queryKey } from "@/lib/comps/stats"
import type { Item } from "@/lib/types"

/** Sales needed before a median counts. */
export const MIN_SOLD = 3

/** The search phrase whose comp_sales rows belong to this title. */
export const titleQueryKey = (title: string) => queryKey(searchPhrase(title))

/** item id → sold median (price + shipping, best offers left out). Items without enough sales are left out. */
export async function soldMedians(supabase: SupabaseClient, items: Pick<Item, "id" | "title">[], userId: string | null): Promise<Map<string, number>> {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  const out = new Map<string, number>()
  for (const i of items) {
    if (!i.title) continue
    const { data: rows } = await supabase
      .from("comp_sales")
      .select("title, price_cents, shipping_cents, best_offer")
      .eq("query_key", titleQueryKey(i.title))
      .gte("sold_on", since)
      .limit(500)
    if (!rows?.length) continue
    const judge = await judgeTitles(i.title, rows.map((r) => r.title), userId)
    const prices = rows.filter((r) => !r.best_offer && judge.keep(r.title)).map((r) => r.price_cents + (r.shipping_cents ?? 0))
    const med = median(prices)
    if (med && prices.length >= MIN_SOLD) out.set(i.id, med)
  }
  return out
}
