// Scan to Comp fair use: each member can check COMP_CHECKS_PER_DAY (default 5) different products
// in 24 hours. Opening a product they already checked in that window is free (it's cached), and a
// "Which one is it?" picker doesn't count until they pick. Emails in COMP_UNLIMITED_EMAILS skip it.
import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { UserError } from "@/lib/errors"

export const compChecksPerDay = () => Math.max(1, Number(process.env.COMP_CHECKS_PER_DAY) || 5)

const unlimited = (email: string) =>
  !!email &&
  (process.env.COMP_UNLIMITED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .includes(email.toLowerCase())

/** "in about 3 hours" / "in about 40 minutes" until `at`. Pure. */
export function resetsIn(at: number, now: number): string {
  const mins = Math.max(1, Math.ceil((at - now) / 60_000))
  if (mins < 60) return `in about ${mins} minute${mins === 1 ? "" : "s"}`
  const hours = Math.round(mins / 60)
  return `in about ${hours} hour${hours === 1 ? "" : "s"}`
}

/**
 * The products this member checked in the last 24 hours, oldest first (one entry per product),
 * and a gate for `lookupComps`: it lets a product through (recording it) or throws a UserError.
 */
export async function compChecks(userId: string, email: string) {
  const admin = createAdminClient()
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const { data } = await admin.from("comp_checks").select("query_key, created_at").eq("user_id", userId).gte("created_at", since).order("created_at").limit(200)
  const first = new Map<string, string>()
  for (const r of data ?? []) if (!first.has(r.query_key)) first.set(r.query_key, r.created_at)
  const limit = compChecksPerDay()
  const free = unlimited(email)
  const state = { used: first.size }
  return {
    /** Checks left after this request (null = no limit for this member). */
    left: () => (free ? null : Math.max(0, limit - state.used)),
    gate: async (key: string) => {
      if (first.has(key)) return
      if (!free && first.size >= limit) {
        const oldest = Date.parse([...first.values()][0]) + 86_400_000
        throw new UserError(
          `You've checked ${limit} products today, the most for now. Your next check frees up ${resetsIn(oldest, Date.now())}. Products you already checked today still open.`,
        )
      }
      first.set(key, new Date().toISOString())
      state.used = first.size
      const { error } = await admin.from("comp_checks").insert({ user_id: userId, query_key: key })
      if (error) console.error("[comp checks]", error)
    },
  }
}
