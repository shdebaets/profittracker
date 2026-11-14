import { PageTitle } from "@/components/app-header"
import { initialsFrom, monthLabel, monthOf, prevMonth, rank } from "@/lib/leaderboard"
import { badgesFor } from "@/lib/leaderboard-badges-run"
import { boardRows } from "@/lib/leaderboard-data"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireUser } from "@/lib/supabase/server"
import { LeaderboardView } from "./leaderboard-view"

export default async function LeaderboardPage() {
  const { supabase, userId, email } = await requireUser()
  const now = monthOf(new Date())
  const last = prevMonth(now)
  const admin = createAdminClient()
  const [rows, lastRows, { data: me }] = await Promise.all([
    boardRows(admin, now),
    boardRows(admin, last),
    supabase.from("leaderboard_profiles").select("display_name, opted_in").maybeSingle(),
  ])
  // Badges only for sellers on the board (opted in) and for you.
  const badges = await badgesFor(admin, [...new Set([userId, ...rows.map((r) => r.userId)])])
  // Only names, totals, badges and whether a row is yours go to the browser.
  const strip = (r: (typeof rows)[number] & { place: number }) => ({
    name: r.name, totals: r.totals, place: r.place, mine: r.userId === userId, badges: (badges.get(r.userId) ?? []).slice(0, 3),
  })
  const champs = {
    profit: rank(lastRows, "profit")[0]?.name ?? null,
    itemsSold: rank(lastRows, "itemsSold")[0]?.name ?? null,
    miles: rank(lastRows, "miles")[0]?.name ?? null,
  }
  return (
    <>
      <PageTitle title="Leaderboard" subtitle={`${monthLabel(now)} rankings · resets monthly`} />
      <LeaderboardView
        boards={{
          profit: rank(rows, "profit").map(strip),
          itemsSold: rank(rows, "itemsSold").map(strip),
          miles: rank(rows, "miles").map(strip),
        }}
        champs={champs}
        lastMonth={monthLabel(last)}
        me={me ?? null}
        myBadges={badges.get(userId) ?? []}
        suggestedName={initialsFrom(email)}
        canPostToDiscord={Boolean(process.env.DISCORD_WINS_WEBHOOK_URL?.trim())}
      />
    </>
  )
}
