// The AI listing fair-use cap. Marketed as unlimited; this only stops abuse, so normal use never
// sees a count. Only "Write it from photos" calls count (kind = 'listing'): the comp judge and
// other AI work log to the same ai_usage table but must not use up a seller's allowance.
import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"

export const AI_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 300
export const LISTING_KIND = "listing"

export const FAIR_USE_MESSAGE =
  "You've written a lot of listings with AI today, so it's taking a short break under our fair-use policy. Try again tomorrow."

/** AI listing calls in the last 24 hours. `admin` is the service-role client (ai_usage has no RLS policies). */
export async function listingCallsToday(admin: SupabaseClient, userId: string, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 86_400_000).toISOString()
  const { count, error } = await admin
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", LISTING_KIND)
    .gte("created_at", since)
  if (error) throw error
  return count ?? 0
}
