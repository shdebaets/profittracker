import { NextResponse, type NextRequest } from "next/server"
import { refreshTrackedProducts } from "@/lib/comps/tracked-refresh"
import { awardMonthlyBadges } from "@/lib/leaderboard-badges-run"
import { checkPoshmarkListings } from "@/lib/marketplaces/assisted-sync"
import { settleAllOffers } from "@/lib/offers-settle-run"
import { runSmartOffers } from "@/lib/marketplaces/ebay/offers"
import { syncEbaySales } from "@/lib/marketplaces/ebay/sync"
import { createAdminClient } from "@/lib/supabase/admin"
import { hasCrosslistAccess } from "@/lib/whop/access"

export const maxDuration = 300

/** Vercel Cron, daily: new marketplace sales, Smart Offers and their outcomes, monthly leaderboard badges, tracked products. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const started = Date.now()
  const admin = createAdminClient()
  const { data: accounts, error } = await admin.from("marketplace_accounts").select("user_id").eq("marketplace", "ebay")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let sales = 0, offers = 0
  const failures: string[] = []
  for (const a of accounts ?? []) {
    try {
      sales += (await syncEbaySales(admin, a.user_id)).sales
    } catch (e) {
      failures.push(a.user_id)
      console.error("sync-sales failed for", a.user_id, e)
    }
    // Smart Offers after the sale sync, so nothing that just sold gets an offer. Cross-Lister only:
    // sales keep syncing for lapsed members, but their offers stop.
    try {
      const { data: u } = await admin.auth.admin.getUserById(a.user_id)
      if (await hasCrosslistAccess(a.user_id, u.user?.email ?? "")) offers += (await runSmartOffers(admin, a.user_id)).sent
    } catch (e) {
      console.error("smart offers failed for", a.user_id, e)
    }
  }
  // Poshmark: everyone's listings not already checked in the last hour.
  let poshmark = 0
  try {
    poshmark = (await checkPoshmarkListings(admin, admin, { staleMs: 60 * 60_000, limit: 500 })).sales.length
  } catch (e) {
    failures.push("poshmark")
    console.error("sync-sales: poshmark check failed", e)
  }
  // Offer outcomes for everyone (eBay and Poshmark/Mercari), after today's sales are in.
  let settled = { sold: 0, expired: 0 }
  try {
    settled = await settleAllOffers(admin)
  } catch (e) {
    failures.push("offers-settle")
    console.error("sync-sales: settling offers failed", e)
  }
  // Leaderboard badges for last month, early in the month (idempotent).
  let badges = 0
  try {
    badges = (await awardMonthlyBadges(admin)).awarded
  } catch (e) {
    failures.push("badges")
    console.error("sync-sales: badges failed", e)
  }
  // Tracked products (Scan to Comp): refresh, alert on price moves. Stops well before maxDuration.
  let tracked: Awaited<ReturnType<typeof refreshTrackedProducts>> | null = null
  try {
    tracked = await refreshTrackedProducts(admin, { deadline: started + 250_000 })
  } catch (e) {
    failures.push("tracked")
    console.error("sync-sales: tracked products failed", e)
  }
  return NextResponse.json({ accounts: accounts?.length ?? 0, sales, offers, poshmark, settled, badges, tracked, failures: failures.length })
}
