// Smart Offers on Poshmark and Mercari: which live listings are due an offer, and at what price.
// No API there, so the seller sends each one (the extension fills the form). Pure.
import { offerPrice, type OfferRule } from "./offers"

export const ASSISTED_OFFER_SITES = ["poshmark", "mercari"] as const
export type AssistedOfferSite = (typeof ASSISTED_OFFER_SITES)[number]

export type OfferCandidate = {
  listingId: string
  itemId: string
  marketplace: string
  title: string
  url: string | null
  listedAt: string | null
  listPriceCents: number | null
  costCents: number | null
}

export type DueOffer = OfferCandidate & { marketplace: AssistedOfferSite; offerCents: number; pct: number; listPriceCents: number }

const DAY = 86_400_000

/** Listings old enough, not offered on within `every_days`, with a real discount above the floor. */
export function dueOffers(listings: OfferCandidate[], lastSent: Map<string, string>, rule: OfferRule, now = new Date()): DueOffer[] {
  const out: DueOffer[] = []
  for (const l of listings) {
    if (!(ASSISTED_OFFER_SITES as readonly string[]).includes(l.marketplace) || !l.listPriceCents || !l.listedAt) continue
    const last = lastSent.get(l.listingId)
    if (last && now.getTime() - Date.parse(last) < rule.every_days * DAY) continue
    const age = Math.floor((now.getTime() - Date.parse(l.listedAt)) / DAY)
    const offer = offerPrice(l.listPriceCents, l.costCents, age, rule)
    if (offer) out.push({ ...l, marketplace: l.marketplace as AssistedOfferSite, listPriceCents: l.listPriceCents, offerCents: offer.cents, pct: offer.pct })
  }
  return out.sort((a, b) => Date.parse(a.listedAt!) - Date.parse(b.listedAt!))
}
