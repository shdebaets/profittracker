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
