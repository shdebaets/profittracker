import "server-only"
import { requireUser } from "@/lib/supabase/server"
import { chartDays, chartStart, confirmedVersion, isLive } from "./metrics"
import { computeSummary, type Headline } from "./summary"
import type { ResearchProduct, ResearchRun } from "./types"

// Reads for the Research pages. Numbers and chart series are computed on the server so
// the browser receives a few KB instead of every listing.

export type { Headline }

export type Offer = {
  id: string
  title: string
  total: number
  url: string | null
  image_url: string | null
  seller: string | null
  feedback: number | null
  bestOffer: boolean
  confirmed: boolean
  soldQty: number | null
  availQty: number | null
}

export async function getResearchItem(productId: string) {
  const { supabase, userId } = await requireUser()
  const { data: product } = await supabase.from("research_products").select("*").eq("id", productId).maybeSingle()
  if (!product) return null
  const [computed, watch, runs, counts] = await Promise.all([
    computeSummary(productId),
    supabase.from("research_watch").select("cost_cents,sale_price_cents,item_id").eq("product_id", productId).eq("user_id", userId).maybeSingle(),
    supabase.from("research_runs").select("*").eq("product_id", productId).order("created_at", { ascending: false }).limit(4),
    supabase.from("research_listings").select("status", { count: "exact", head: false }).eq("product_id", productId).in("status", ["review", "rejected"]),
  ])
  const { headline, listings, sales, release } = computed
  const live = listings.filter((l) => isLive(l))
  const offers: Offer[] = live
    .filter((l) => (l.buying_options ?? []).includes("FIXED_PRICE") && !l.presale)
    .map((l) => ({
      id: l.id,
      title: l.title,
      total: Number(l.price ?? 0) + Number(l.shipping ?? 0),
      url: l.url,
      image_url: l.image_url,
      seller: l.seller,
      feedback: l.seller_feedback,
      bestOffer: l.best_offer,
      confirmed: confirmedVersion(l),
      soldQty: l.sold_qty,
      availQty: l.avail_qty,
    }))
    .filter((o) => o.total > 0)
    .sort((a, b) => a.total - b.total)
    .slice(0, 40)
  const from = chartStart(listings, sales, release)
  const statusCounts = (counts.data ?? []).reduce<Record<string, number>>((m, r) => ((m[r.status as string] = (m[r.status as string] ?? 0) + 1), m), {})
  const runList = (runs.data ?? []) as ResearchRun[]
  return {
    product: product as ResearchProduct,
    headline,
    days: chartDays(listings, sales, from, release),
    offers,
    watch: watch.data as { cost_cents: number | null; sale_price_cents: number | null; item_id: string | null } | null,
    track: runList.find((r) => r.kind === "track") ?? null,
    sold: runList.find((r) => r.kind === "sold") ?? null,
    review: statusCounts.review ?? 0,
    rejected: statusCounts.rejected ?? 0,
    soldCollected: sales.some((s) => s.source === "collector"),
  }
}

export type ResearchItem = NonNullable<Awaited<ReturnType<typeof getResearchItem>>>

/** The signed-in user's research list with cached numbers. */
export async function getResearchList() {
  const { supabase } = await requireUser()
  const { data, error } = await supabase
    .from("research_watch")
    .select("cost_cents,sale_price_cents,item_id,created_at,product:research_products(id,name,image_url,summary,last_status,last_refresh_at)")
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []).flatMap((w) => {
    const p = (Array.isArray(w.product) ? w.product[0] : w.product) as
      | { id: string; name: string; image_url: string | null; summary: Headline | null; last_status: string | null; last_refresh_at: string | null }
      | null
    return p ? [{ ...p, cost_cents: w.cost_cents as number | null, sale_price_cents: w.sale_price_cents as number | null, item_id: w.item_id as string | null }] : []
  })
}
