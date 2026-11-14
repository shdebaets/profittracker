// Smart Offers on eBay (Negotiation API): send offers to watchers of the seller's listings,
// within their rules. Runs from the daily cron. eBay only: Poshmark and Mercari have no API and
// automating offers there is the kind of bot activity their terms ban (those are assisted, see
// lib/offers-assisted.ts).
import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { offerPrice, type OfferRule } from "@/lib/offers"
import { ebayFetch } from "./client"
import { toEbayMoney } from "./mapping"
import { getUserToken } from "./oauth"

const DAY = 86_400_000

export async function runSmartOffers(admin: SupabaseClient, userId: string, now = new Date()) {
  const { data: rule } = await admin.from("smart_offer_rules").select("*").eq("user_id", userId).maybeSingle<OfferRule & { enabled: boolean }>()
  await settleOutcomes(admin, userId, now)
  if (!rule?.enabled) return { sent: 0 }

  const { data: last } = await admin
    .from("smart_offers")
    .select("sent_at")
    .eq("user_id", userId)
    .eq("marketplace", "ebay")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ sent_at: string }>()
  if (last && now.getTime() - Date.parse(last.sent_at) < rule.every_days * DAY - 3_600_000) return { sent: 0 }

  const auth = await getUserToken(userId, admin)
  if (!auth) return { sent: 0 }
  const eligible = await ebayFetch<{ eligibleItems?: { listingId: string }[] }>(
    auth.token,
    "/sell/negotiation/v1/find_eligible_items?limit=200",
    { host: "api" },
  ).catch((e) => {
    console.error("[smart offers] find_eligible_items failed", userId, e)
    return { eligibleItems: [] }
  })
  const ids = (eligible.eligibleItems ?? []).map((e) => e.listingId)
  if (!ids.length) return { sent: 0 }

  // Only listings FlipLedger knows, so we know the cost floor.
  const { data: listings } = await admin
    .from("marketplace_listings")
    .select("external_id, price_cents, listed_at, item:items(id, title, cost_cents, cost_unknown, list_price_cents, status)")
    .eq("user_id", userId)
    .eq("marketplace", "ebay")
    .eq("status", "active")
    .in("external_id", ids)
  let sent = 0
  for (const l of listings ?? []) {
    const item = (Array.isArray(l.item) ? l.item[0] : l.item) as {
      id: string; title: string | null; cost_cents: number; cost_unknown: boolean; list_price_cents: number | null; status: string
    } | null
    const price = l.price_cents ?? item?.list_price_cents ?? null
    if (!item || item.status !== "inventory" || price == null || !l.external_id) continue
    const age = l.listed_at ? (now.getTime() - Date.parse(l.listed_at)) / DAY : 0
    const offer = offerPrice(price, item.cost_unknown ? null : item.cost_cents, age, rule)
    if (!offer) continue
    let error: string | null = null
    try {
      await ebayFetch(auth.token, "/sell/negotiation/v1/send_offer_to_interested_buyers", {
        body: {
          allowCounterOffer: false,
          message: `Thanks for watching! Here's ${offer.pct}% off for the next 2 days.`,
          offerDuration: { unit: "DAY", value: 2 },
          offeredItems: [{ listingId: l.external_id, price: toEbayMoney(offer.cents), quantity: 1 }],
        },
      })
      sent++
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 300) : "failed"
      console.error("[smart offers] send failed", userId, l.external_id, e)
    }
    await admin.from("smart_offers").insert({
      user_id: userId, item_id: item.id, listing_id: l.external_id, title: item.title,
      list_price_cents: price, offer_cents: offer.cents, error,
    })
  }
  return { sent }
}

/** An offer "worked" if the item sold within 3 days of it at or under the offer price (+$1). */
async function settleOutcomes(admin: SupabaseClient, userId: string, now: Date) {
  const { data } = await admin
    .from("smart_offers")
    .select("id, sent_at, offer_cents, item:items(status, sold_at, sale_price_cents)")
    .eq("user_id", userId)
    .is("outcome", null)
    .is("error", null)
    .lt("sent_at", new Date(now.getTime() - 3 * DAY).toISOString())
    .limit(200)
  for (const o of data ?? []) {
    const item = (Array.isArray(o.item) ? o.item[0] : o.item) as { status: string; sold_at: string | null; sale_price_cents: number | null } | null
    const sold =
      item?.status === "sold" && item.sold_at &&
      Date.parse(item.sold_at) >= Date.parse(o.sent_at) &&
      Date.parse(item.sold_at) <= Date.parse(o.sent_at) + 3 * DAY &&
      (item.sale_price_cents ?? Infinity) <= o.offer_cents + 100
    await admin.from("smart_offers").update({ outcome: sold ? "sold" : "expired" }).eq("id", o.id)
  }
}
