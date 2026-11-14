// Awards last month's leaderboard badges from the daily cron. Idempotent: one row per
// (month, board, place), so running again (or twice at once) adds nothing.
import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { badgeAwards, badgeMonthDue, type Badge, type Month } from "./leaderboard"
import { boardRows } from "./leaderboard-data"
import { badgePush } from "./push/badge-messages"
import { pushToUser } from "./push/send"

export async function awardMonthlyBadges(admin: SupabaseClient, now = new Date(), month: Month | null = badgeMonthDue(now)) {
  if (!month) return { awarded: 0 }
  const { count } = await admin
    .from("leaderboard_badges")
    .select("id", { count: "exact", head: true })
    .eq("year", month.year)
    .eq("month", month.month)
  if (count) return { awarded: 0 } // already done for this month

  const awards = badgeAwards(await boardRows(admin, month), month)
  if (!awards.length) return { awarded: 0 }
  const { data, error } = await admin
    .from("leaderboard_badges")
    .upsert(
      awards.map((a) => ({ user_id: a.userId, year: a.year, month: a.month, board: a.board, place: a.place, display_name: a.name, value: a.value })),
      { onConflict: "year,month,board,place", ignoreDuplicates: true },
    )
    .select("user_id, year, month, board, place")
  if (error) throw error
  for (const b of (data ?? []) as (Badge & { user_id: string })[]) {
    await pushToUser(admin, b.user_id, badgePush(b)).catch((e) => console.error("[badges] push failed", e))
  }
  return { awarded: data?.length ?? 0 }
}

/** Badges for these sellers, newest first. Admin client: callers pass only ids they may show. */
export async function badgesFor(admin: SupabaseClient, userIds: string[]): Promise<Map<string, Badge[]>> {
  const out = new Map<string, Badge[]>()
  if (!userIds.length) return out
  const { data } = await admin
    .from("leaderboard_badges")
    .select("user_id, year, month, board, place")
    .in("user_id", userIds)
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .order("place", { ascending: true })
    .limit(2000)
  for (const b of (data ?? []) as (Badge & { user_id: string })[]) {
    const list = out.get(b.user_id) ?? []
    list.push({ year: b.year, month: b.month, board: b.board, place: b.place })
    out.set(b.user_id, list)
  }
  return out
}
