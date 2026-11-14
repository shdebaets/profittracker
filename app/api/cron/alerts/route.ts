import { NextResponse, type NextRequest } from "next/server"
import { prefetchListedComps } from "@/lib/alerts/prefetch-comps"
import { runAlertDigest } from "@/lib/email/alert-digest"
import { createAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 300

/**
 * Vercel Cron, daily: read sold prices for listed products nobody comped lately (capped), then on
 * Monday to Wednesday send the weekly "N stale, M overpriced" digest to whoever hasn't had it.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const started = Date.now()
  const admin = createAdminClient()
  let prefetch: unknown
  try {
    prefetch = await prefetchListedComps(admin)
  } catch (e) {
    console.error("[alerts cron] prefetch failed", e)
    prefetch = { error: true }
  }
  // Leave the digest whatever time the prefetch didn't use, with a margin under maxDuration.
  const digest = await runAlertDigest(admin, new Date(), started + 270_000)
  return NextResponse.json({ prefetch, digest })
}
