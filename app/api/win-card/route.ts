import { NextResponse, type NextRequest } from "next/server"
import { monthLabel, monthOf, prevMonth, type Month } from "@/lib/leaderboard"
import { sellerMonth } from "@/lib/leaderboard-data"
import { createClient } from "@/lib/supabase/server"
import { winCard } from "@/lib/win-card"

/** The signed-in seller's win card for ?m=YYYY-MM (default: this month). */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) return NextResponse.json({ error: "Sign in" }, { status: 401 })
  const raw = request.nextUrl.searchParams.get("m") ?? ""
  const match = raw.match(/^(\d{4})-(\d{2})$/)
  const m: Month = match ? { year: Number(match[1]), month: Number(match[2]) - 1 } : request.nextUrl.searchParams.get("last") ? prevMonth(monthOf(new Date())) : monthOf(new Date())
  const totals = await sellerMonth(supabase, data.claims.sub, m)
  const { data: profile } = await supabase.from("leaderboard_profiles").select("display_name").maybeSingle()
  return winCard({ name: profile?.display_name ?? "A FlipLedger seller", month: monthLabel(m), ...totals })
}
