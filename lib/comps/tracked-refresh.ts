// Daily refresh of tracked products (from the sync-sales cron): re-runs the comp lookup for the
// products checked longest ago, saves the numbers, and pushes when the sold median crosses under
// the seller's target buy price or moves more than 15%. Capped so it never eats the paid sold-data
// budget that live scans need: per user, overall, and only while under half of the day's requests.
import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { pushToUser } from "@/lib/push/send"
import { trackedPush } from "@/lib/push/comp-messages"
import { isPick, lookupComps } from "./lookup"
import { soldDailyLimit, soldMonthlyLimit, soldRequestsToday } from "./sold-api"
import type { CompStats } from "./stats"
import { soldMedianOf, trackedAlert } from "./tracked-alerts"

const PER_USER = () => Number(process.env.TRACKED_REFRESH_PER_USER) || 10
const PER_RUN = () => Number(process.env.TRACKED_REFRESH_DAILY) || 100
/** Share of SOLD_DATA_DAILY_LIMIT the cron may use up to; the rest is kept for live scans. */
const BUDGET_SHARE = () => Number(process.env.TRACKED_REFRESH_BUDGET_SHARE) || 0.5
const STALE_MS = 20 * 60 * 60_000

type Row = {
  id: string
  user_id: string
  query: string
  gtin: string | null
  product: string | null
  title: string | null
  target_cost_cents: number | null
  stats: CompStats | null
  alert_median_cents: number | null
}

export async function refreshTrackedProducts(
  admin: SupabaseClient,
  opts: { deadline?: number; now?: Date } = {},
): Promise<{ checked: number; alerts: number; skipped: number; stoppedBy: "done" | "budget" | "time" | "cap" }> {
  const now = opts.now ?? new Date()
  const { data, error } = await admin
    .from("tracked_products")
    .select("id, user_id, query, gtin, product, title, target_cost_cents, stats, alert_median_cents")
    .or(`checked_at.is.null,checked_at.lt.${new Date(now.getTime() - STALE_MS).toISOString()}`)
    .order("checked_at", { ascending: true, nullsFirst: true })
    .limit(1000)
  if (error) throw error
  const perUser = new Map<string, number>()
  // The cron's share of a day: of SOLD_DATA_DAILY_LIMIT if set, else of a 30th of the monthly plan.
  const day = Number.isFinite(soldDailyLimit()) ? soldDailyLimit() : soldMonthlyLimit() / 30
  const budget = Math.floor(day * BUDGET_SHARE())
  let checked = 0, alerts = 0, skipped = 0
  for (const t of (data ?? []) as Row[]) {
    if (checked >= PER_RUN()) return { checked, alerts, skipped, stoppedBy: "cap" }
    if (opts.deadline && Date.now() > opts.deadline) return { checked, alerts, skipped, stoppedBy: "time" }
    if ((perUser.get(t.user_id) ?? 0) >= PER_USER()) {
      skipped++
      continue
    }
    if ((await soldRequestsToday()) >= budget) return { checked, alerts, skipped, stoppedBy: "budget" }
    perUser.set(t.user_id, (perUser.get(t.user_id) ?? 0) + 1)
    try {
      // Same lookup as the Refresh button. Old rows have no product: their query is the search phrase.
      const l = await lookupComps(admin, t.gtin ?? t.query, { userId: t.user_id, product: t.gtin ? null : t.product ?? t.query, now })
      checked++
      if (isPick(l)) continue
      const median = soldMedianOf(l.stats)
      const { alert, baselineCents } = trackedAlert({
        targetCents: t.target_cost_cents,
        baselineCents: t.alert_median_cents,
        prevMedianCents: soldMedianOf(t.stats),
        medianCents: median,
      })
      const { error: upErr } = await admin
        .from("tracked_products")
        .update({
          stats: l.stats, title: l.title, image_url: l.image, checked_at: now.toISOString(),
          alert_median_cents: baselineCents, ...(alert ? { alerted_at: now.toISOString() } : {}),
        })
        .eq("id", t.id)
        .eq("user_id", t.user_id)
      if (upErr) throw upErr
      if (alert) {
        alerts++
        await pushToUser(admin, t.user_id, trackedPush(t.title ?? l.product, alert, t.target_cost_cents, t.gtin ?? t.query)).catch((e) => console.error("[tracked push]", e))
      }
    } catch (e) {
      console.error("[tracked refresh]", t.id, e)
    }
  }
  return { checked, alerts, skipped, stoppedBy: "done" }
}
