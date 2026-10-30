import { NextResponse, type NextRequest } from "next/server"
import { checkPoshmarkListings } from "@/lib/marketplaces/assisted-sync"
import { syncEbaySales } from "@/lib/marketplaces/ebay/sync"
import { createAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 300

/** Vercel Cron: pull new marketplace sales for every connected account. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const admin = createAdminClient()
  const { data: accounts, error } = await admin.from("marketplace_accounts").select("user_id").eq("marketplace", "ebay")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let sales = 0
  const failures: string[] = []
  for (const a of accounts ?? []) {
    try {
      sales += (await syncEbaySales(admin, a.user_id)).sales
    } catch (e) {
      failures.push(a.user_id)
      console.error("sync-sales failed for", a.user_id, e)
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
  return NextResponse.json({ accounts: accounts?.length ?? 0, sales, poshmark, failures: failures.length })
}
