import { NextResponse, type NextRequest } from "next/server"
import { start } from "workflow/api"
import { EBAY_DAILY_BUDGET, ebayCallsToday } from "@/lib/research/ebay"
import { dueProducts, startRun, updateRun } from "@/lib/research/pipeline"
import { createAdminClient } from "@/lib/supabase/admin"
import { trackProduct } from "@/workflows/research"

export const maxDuration = 60

/**
 * Vercel Cron (daily): refresh live listings for every product someone watches, and
 * restart runs that paused for the eBay budget. The work runs as durable workflows.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  // Background refreshes leave the last 25% of the shared daily eBay quota for people using the app.
  if ((await ebayCallsToday()) > EBAY_DAILY_BUDGET * 0.75) return NextResponse.json({ skipped: "eBay quota reserved for interactive use" })
  const admin = createAdminClient()
  const { data: running } = await admin.from("research_runs").select("product_id").eq("kind", "track").eq("status", "running")
  const busy = new Set((running ?? []).map((r) => r.product_id as string))
  const ids = (await dueProducts(40)).filter((id) => !busy.has(id))
  let started = 0
  for (const id of ids) {
    try {
      const runId = await startRun(id, "track")
      const run = await start(trackProduct, [id, runId])
      await updateRun(runId, { workflow_run_id: run.runId })
      started++
    } catch (e) {
      console.error("research-refresh: couldn't start", id, e)
    }
  }
  return NextResponse.json({ due: ids.length, started })
}
