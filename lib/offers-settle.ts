// Smart Offers outcomes: link each offer to the real sale it led to. Pure.
//
// An offer gets credit for a sale of the same item on the same marketplace, made after the offer
// was sent and within SALE_WINDOW_MS, at a unit price no more than $1 over the offer (a buyer who
// paid the full price didn't need the offer). Assisted sales (Poshmark, Mercari) are recorded per
// listing, so they must also be the offered listing. Each sale is credited to one offer only: the
// latest one sent before it. Offers with no sale once the window (plus sync lag) is over expire.

export const SALE_WINDOW_MS = 3 * 86_400_000 // eBay offers last 2 days; Posh/Mercari sales are seen late
export const SETTLE_AFTER_MS = SALE_WINDOW_MS + 86_400_000 // the daily sale sync may land a day later
const PRICE_SLACK_CENTS = 100

export type OpenOffer = {
  id: string
  userId: string
  itemId: string | null
  listingId: string
  marketplace: string
  sentAt: string
  offerCents: number
}

export type SaleLine = {
  marketplace: string
  lineId: string // marketplace_sales.external_line_id (eBay line id, or our listing id for assisted sites)
  userId: string
  itemId: string | null
  unitCents: number | null
  quantity: number
  soldAt: string
}

export type Settlement =
  | { offerId: string; outcome: "sold"; sale: SaleLine; saleCents: number }
  | { offerId: string; outcome: "expired" }

/**
 * Settle what can be settled. `taken` holds "marketplace:lineId" of sales already credited to an
 * offer (earlier runs). Offers still inside their window with no sale yet are left open.
 */
export function settleOffers(offers: OpenOffer[], sales: SaleLine[], taken: Set<string>, now = new Date()): Settlement[] {
  const used = new Set(taken)
  const out: Settlement[] = []
  // Newest offers pick first, so a sale goes to the latest offer sent before it.
  const ordered = [...offers].sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))
  for (const o of ordered) {
    const sent = Date.parse(o.sentAt)
    const match = sales
      .filter((s) => {
        const at = Date.parse(s.soldAt)
        return (
          s.userId === o.userId &&
          s.marketplace === o.marketplace &&
          o.itemId != null &&
          s.itemId === o.itemId &&
          (o.marketplace === "ebay" || s.lineId === o.listingId) &&
          at >= sent &&
          at <= sent + SALE_WINDOW_MS &&
          s.unitCents != null &&
          s.unitCents <= o.offerCents + PRICE_SLACK_CENTS &&
          !used.has(`${s.marketplace}:${s.lineId}`)
        )
      })
      .sort((a, b) => Date.parse(a.soldAt) - Date.parse(b.soldAt))[0]
    if (match) {
      used.add(`${match.marketplace}:${match.lineId}`)
      out.push({ offerId: o.id, outcome: "sold", sale: match, saleCents: match.unitCents! * Math.max(1, match.quantity) })
    } else if (now.getTime() - sent >= SETTLE_AFTER_MS) {
      out.push({ offerId: o.id, outcome: "expired" })
    }
  }
  return out
}

export type OfferReport = { sent: number; accepted: number; revenueCents: number; acceptRate: number }

/** Totals for Settings: offers that went out, how many led to a sale, and what those sales brought in. */
export function offerReport(rows: { error: string | null; outcome: string | null; sale_cents: number | null }[]): OfferReport {
  const sent = rows.filter((r) => !r.error).length
  const won = rows.filter((r) => r.outcome === "sold")
  const settled = rows.filter((r) => !r.error && r.outcome != null).length
  return {
    sent,
    accepted: won.length,
    revenueCents: won.reduce((a, r) => a + (r.sale_cents ?? 0), 0),
    acceptRate: settled ? Math.round((won.length / settled) * 100) : 0,
  }
}
