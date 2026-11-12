import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { headlineMetrics } from "./metrics"
import type { Listing, ResearchProduct, Sale } from "./types"

const LISTING_COLUMNS =
  "id,product_id,item_id,legacy_id,title,price,shipping,buying_options,image_url,url,status,version_key,presale,best_offer,start_date,end_date,sold_qty,avail_qty,details_state,live,last_seen,seller,seller_feedback,condition,reason"
const SALE_COLUMNS =
  "id,product_id,external_id,listing_id,source,version_key,verdict,sold_on,title,url,price,shipping,best_offer,presale,format,qty,units,volume_days,listing_created_at,details_state"

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) return out
  }
}

export type Headline = ReturnType<typeof headlineMetrics>

/** Counted listings and all sales for a product (only the columns the math needs). */
export async function loadResearchData(productId: string) {
  const admin = createAdminClient()
  const { data: product } = await admin.from("research_products").select("profile").eq("id", productId).single()
  const release = (product?.profile as ResearchProduct["profile"] | undefined)?.release_date ?? null
  const [listings, sales] = await Promise.all([
    all<Listing>((a, b) => admin.from("research_listings").select(LISTING_COLUMNS).eq("product_id", productId).eq("status", "counted").order("id").range(a, b)),
    all<Sale>((a, b) => admin.from("research_sales").select(SALE_COLUMNS).eq("product_id", productId).order("id").range(a, b)),
  ])
  return { listings, sales, release }
}

/** Compute the headline numbers and cache them on the product row (for lists). */
export async function computeSummary(productId: string) {
  const data = await loadResearchData(productId)
  const headline = headlineMetrics(data.listings, data.sales, data.release)
  await createAdminClient().from("research_products").update({ summary: headline }).eq("id", productId)
  return { ...data, headline }
}
