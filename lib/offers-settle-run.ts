// Settles Smart Offers for every seller (eBay and assisted), from the sales FlipLedger recorded.
// Its own step in the daily cron, so sellers without eBay connected get outcomes too.
import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { SALE_WINDOW_MS, settleOffers, type OpenOffer, type SaleLine } from "./offers-settle"

const BATCH = 1000
const chunks = <T,>(xs: T[], n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

/** Admin client only: reads and writes across users, always matching a sale to its own seller's offer. */
export async function settleAllOffers(admin: SupabaseClient, now = new Date()) {
  const { data: open, error } = await admin
    .from("smart_offers")
    .select("id, user_id, item_id, listing_id, marketplace, sent_at, offer_cents")
    .is("outcome", null)
    .is("error", null)
    .lt("sent_at", now.toISOString())
    .order("sent_at", { ascending: true })
    .limit(BATCH)
  if (error) throw error
  if (!open?.length) return { sold: 0, expired: 0 }

  const offers: OpenOffer[] = open.map((o) => ({
    id: o.id, userId: o.user_id, itemId: o.item_id, listingId: o.listing_id,
    marketplace: o.marketplace, sentAt: o.sent_at, offerCents: o.offer_cents,
  }))
  const itemIds = [...new Set(offers.map((o) => o.itemId).filter((x): x is string => !!x))]
  const earliest = new Date(Math.min(...offers.map((o) => Date.parse(o.sentAt)))).toISOString()

  type SaleRow = { marketplace: string; external_line_id: string; user_id: string; item_id: string | null; sale_cents: number | null; quantity: number | null; sold_at: string | null; created_at: string }
  const rows: SaleRow[] = []
  for (const ids of chunks(itemIds)) {
    const { data, error: e } = await admin
      .from("marketplace_sales")
      .select("marketplace, external_line_id, user_id, item_id, sale_cents, quantity, sold_at, created_at")
      .in("item_id", ids)
      .gte("created_at", earliest)
    if (e) throw e
    rows.push(...((data ?? []) as SaleRow[]))
  }

  // Sales recorded before amounts were stored on marketplace_sales: read them off the sold item row.
  const legacy = [...new Set(rows.filter((r) => r.sale_cents == null && r.item_id).map((r) => r.item_id!))]
  const legacyItems = new Map<string, { status: string; sale_price_cents: number | null; quantity: number; sold_at: string | null }>()
  for (const ids of chunks(legacy)) {
    const { data } = await admin.from("items").select("id, status, sale_price_cents, quantity, sold_at").in("id", ids)
    for (const i of data ?? []) legacyItems.set(i.id, i)
  }
  const sales: SaleLine[] = rows.map((r) => {
    const old = r.sale_cents == null && r.item_id ? legacyItems.get(r.item_id) : undefined
    const oldSold = old?.status === "sold" ? old : undefined
    return {
      marketplace: r.marketplace,
      lineId: r.external_line_id,
      userId: r.user_id,
      itemId: r.item_id,
      unitCents: r.sale_cents ?? oldSold?.sale_price_cents ?? null,
      quantity: r.quantity ?? oldSold?.quantity ?? 1,
      soldAt: r.sold_at ?? oldSold?.sold_at ?? r.created_at,
    }
  })

  // Sales already credited to an offer in an earlier run.
  const taken = new Set<string>()
  const { data: linked } = await admin
    .from("smart_offers")
    .select("sale_marketplace, sale_line_id")
    .not("sale_line_id", "is", null)
    .gte("sent_at", new Date(Date.parse(earliest) - SALE_WINDOW_MS).toISOString())
  for (const l of linked ?? []) taken.add(`${l.sale_marketplace}:${l.sale_line_id}`)

  let sold = 0, expired = 0
  const settledAt = now.toISOString()
  for (const s of settleOffers(offers, sales, taken, now)) {
    const patch =
      s.outcome === "sold"
        ? { outcome: "sold", sale_marketplace: s.sale.marketplace, sale_line_id: s.sale.lineId, sale_cents: s.saleCents, sold_at: s.sale.soldAt, settled_at: settledAt }
        : { outcome: "expired", settled_at: settledAt }
    const { error: upErr } = await admin.from("smart_offers").update(patch).eq("id", s.offerId).is("outcome", null)
    if (upErr) console.error("[smart offers] settle failed", s.offerId, upErr)
    else if (s.outcome === "sold") sold++
    else expired++
  }
  return { sold, expired }
}
