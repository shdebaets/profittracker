// The daily readings job: re-reads the sold count of every listing still selling that a comp
// looked at in the last week, so units sold per day (the change between readings, comp_item_counts)
// build up even when nobody reopens the product. Browse calls only (free, within
// COMP_UNITS_DAILY_LIMIT); no paid sold-data requests.
import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadUnits } from "./units"

const MAX = () => Number(process.env.COMP_READINGS_DAILY) || 2500

/** Re-reads listings not read in 20 hours, biggest sellers first, until the cap or the deadline. */
export async function refreshUnitReadings(opts: { deadline?: number } = {}): Promise<{ due: number; read: number; stoppedBy: "done" | "time" | "cap" }> {
  const admin = createAdminClient()
  const since = new Date(Date.now() - 8 * 86_400_000).toISOString()
  const before = new Date(Date.now() - 20 * 3_600_000).toISOString()
  const ids: string[] = []
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await admin
      .from("comp_items")
      .select("item_id")
      .eq("ended", false)
      .gte("fetched_at", since)
      .lt("fetched_at", before)
      .order("sold_qty", { ascending: false, nullsFirst: false })
      .range(from, from + 999)
    if (error) throw error
    ids.push(...(data ?? []).map((r) => r.item_id))
    if ((data?.length ?? 0) < 1000) break
  }
  const due = Math.min(ids.length, MAX())
  let read = 0
  for (let i = 0; i < due; i += 200) {
    if (opts.deadline && Date.now() > opts.deadline) return { due, read, stoppedBy: "time" }
    const batch = ids.slice(i, Math.min(i + 200, due))
    await loadUnits(batch, new Set(), { calls: batch.length, staleMs: 20 * 3_600_000 })
    read += batch.length
  }
  return { due, read, stoppedBy: ids.length > due ? "cap" : "done" }
}
