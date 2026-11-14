import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"
import { AI_DAILY_LIMIT, listingCallsToday } from "./usage"

/** Rows in ai_usage; the fake applies eq/gte filters like PostgREST would. */
function fake(rows: { user_id: string; kind: string; created_at: string }[]) {
  const filters: [string, string, string][] = []
  const q = {
    select: () => q,
    eq: (c: string, v: string) => (filters.push(["eq", c, v]), q),
    gte: (c: string, v: string) => (filters.push(["gte", c, v]), q),
    then(resolve: (r: { count: number; error: null }) => void) {
      const count = rows.filter((r) =>
        filters.every(([op, c, v]) => (op === "eq" ? (r as Record<string, string>)[c] === v : (r as Record<string, string>)[c] >= v)),
      ).length
      resolve({ count, error: null })
    },
  }
  return { client: { from: () => q } as unknown as SupabaseClient, filters }
}

describe("AI listing cap", () => {
  const now = new Date("2026-11-14T12:00:00Z")
  const at = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString()

  it("counts only listing calls from the last 24 hours, for this seller", async () => {
    const { client, filters } = fake([
      { user_id: "u1", kind: "listing", created_at: at(1) },
      { user_id: "u1", kind: "listing", created_at: at(23) },
      { user_id: "u1", kind: "comp_judge", created_at: at(1) },
      { user_id: "u1", kind: "comp_judge", created_at: at(2) },
      { user_id: "u1", kind: "listing", created_at: at(30) },
      { user_id: "u2", kind: "listing", created_at: at(1) },
    ])
    expect(await listingCallsToday(client, "u1", now)).toBe(2)
    expect(filters).toContainEqual(["eq", "kind", "listing"])
  })

  it("defaults to 300 a day", () => expect(AI_DAILY_LIMIT).toBe(300))
})
