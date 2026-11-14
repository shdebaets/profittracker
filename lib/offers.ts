// Smart Offers: what to offer watchers of an eBay listing. Pure.
export type OfferRule = {
  discount_pct: number
  max_discount_pct: number
  floor_margin_pct: number
  min_age_days: number
  every_days: number
}

/**
 * The offer price for a listing, or null when it shouldn't get one.
 * Starts at discount_pct off and goes deeper for older listings (1 point per week past min_age),
 * capped at max_discount_pct, and never below cost × (1 + floor margin). Unknown cost: no floor
 * beyond the max discount.
 */
export function offerPrice(
  listPriceCents: number,
  costCents: number | null,
  ageDays: number,
  rule: OfferRule,
): { cents: number; pct: number } | null {
  if (ageDays < rule.min_age_days || listPriceCents <= 0) return null
  const weeksOver = Math.floor((ageDays - rule.min_age_days) / 7)
  const pct = Math.min(rule.max_discount_pct, rule.discount_pct + weeksOver)
  let cents = Math.round(listPriceCents * (1 - pct / 100))
  const floor = costCents != null ? Math.round(costCents * (1 + rule.floor_margin_pct / 100)) : 0
  if (cents < floor) cents = floor
  // eBay wants a real discount: at least 5% off and a dollar or more.
  if (cents > listPriceCents * 0.95 || listPriceCents - cents < 100) return null
  return { cents, pct: Math.round((1 - cents / listPriceCents) * 100) }
}

const DAY = 86_400_000
// The cron runs once a day at about the same time; an hour of slack keeps "every 1 day" daily.
const CRON_SLACK_MS = 3_600_000

/** "How often" is per listing: due when this listing has no offer yet, or its last one is `every_days` old. */
export function offerDue(lastSentAt: string | undefined, everyDays: number, now = new Date()) {
  return !lastSentAt || now.getTime() - Date.parse(lastSentAt) >= everyDays * DAY - CRON_SLACK_MS
}

/** Newest sent_at per listing, from rows ordered newest first (or any order). */
export function lastSentByListing(rows: { listing_id: string; sent_at: string }[]) {
  const last = new Map<string, string>()
  for (const r of rows) {
    const prev = last.get(r.listing_id)
    if (!prev || Date.parse(r.sent_at) > Date.parse(prev)) last.set(r.listing_id, r.sent_at)
  }
  return last
}
