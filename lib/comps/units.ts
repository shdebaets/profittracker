// Units per eBay listing (CompAmp's details step). eBay's sold search shows a multi-quantity
// listing once, however many units it sold, so counting search results undercounts busy products
// badly (Pokémon UPC Night: 688 listings, 1,851 units). The Browse API's item details carry
// estimatedSoldQuantity: read it once per listing (shared in comp_items) and count units.
// Ended listings may have no details any more; they count as 1, which is right for most of them.
import "server-only"
import { EbayError, ebayFetch } from "@/lib/marketplaces/ebay/client"
import { getAppToken } from "@/lib/marketplaces/ebay/oauth"
import { createAdminClient } from "@/lib/supabase/admin"
import { etDay, type UnitHistory } from "./stats"

export type ItemUnits = { soldQty: number | null; createdOn: string | null; ended: boolean }

type Item = {
  itemId?: string
  legacyItemId?: string
  itemCreationDate?: string
  itemEndDate?: string
  estimatedAvailabilities?: { estimatedSoldQuantity?: number; estimatedAvailabilityStatus?: string }[]
}

const LIVE_TTL_MS = 24 * 60 * 60_000
const maxCalls = () => Number(process.env.COMP_UNITS_MAX_CALLS) || 80
/** Calls for the rest, after the comp screen has its answer (Night needs ~1,100 listings read once). */
export const backgroundUnitCalls = () => Number(process.env.COMP_UNITS_BACKGROUND_CALLS) || 1000
/** Single-item calls in flight at once (getItems batches are a restricted API: our keyset gets 403). */
// 16 at once: eBay slows each call past ~16 (0.85 s at 8, 1.5 s at 20), so more buys little.
const PARALLEL = 16
let batchDenied = false
// eBay allows 5,000 Browse calls a day; live searches use some of them.
const dailyLimit = () => Number(process.env.COMP_UNITS_DAILY_LIMIT) || 4000

/** One Browse item → its units, or null for an item without a number. Pure. */
export function toItemUnits(i: Item, now = Date.now()): { id: string; units: ItemUnits } | null {
  const id = i.legacyItemId ?? i.itemId?.match(/\|(\d{9,15})\|/)?.[1]
  if (!id) return null
  const sold = i.estimatedAvailabilities?.[0]?.estimatedSoldQuantity
  const end = i.itemEndDate ? Date.parse(i.itemEndDate) : NaN
  return {
    id,
    units: {
      soldQty: typeof sold === "number" && Number.isFinite(sold) ? Math.max(0, Math.floor(sold)) : null,
      createdOn: i.itemCreationDate?.slice(0, 10) ?? null,
      ended: (Number.isFinite(end) && end < now) || i.estimatedAvailabilities?.[0]?.estimatedAvailabilityStatus === "OUT_OF_STOCK",
    },
  }
}

/** Browse calls used today; adds `calls` atomically (background loads can run side by side). */
async function spend(calls: number): Promise<number> {
  const admin = createAdminClient()
  const key = `units-calls:${new Date().toISOString().slice(0, 10)}`
  if (calls) {
    const { data, error } = await admin.rpc("comp_count_add", { p_key: key, p_n: calls })
    if (!error) return Number(data) || 0
    console.error("[comp units] count", error)
  }
  const { data } = await admin.from("comp_cache").select("payload").eq("key", key).maybeSingle()
  return Number((data?.payload as { calls?: number })?.calls ?? 0)
}

/**
 * Units for these listings: cached ones from comp_items, the rest from the Browse API (at most
 * `calls` calls, default COMP_UNITS_MAX_CALLS, and COMP_UNITS_DAILY_LIMIT a day; whatever's left
 * waits for a later load and counts as 1 meanwhile). `live`: ids of listings still for sale,
 * whose counts are re-read daily. Never throws.
 */
export async function loadUnits(
  ids: string[],
  live: Set<string> = new Set(),
  /** fetch: false = only what's on file (stale counts included), no eBay calls. calls: this call's cap. */
  { fetch = true, calls: cap = maxCalls() }: { fetch?: boolean; calls?: number } = {},
): Promise<Map<string, ItemUnits>> {
  const out = new Map<string, ItemUnits>()
  const unique = [...new Set(ids.filter((id) => /^\d{9,15}$/.test(id)))]
  if (!unique.length) return out
  const admin = createAdminClient()
  try {
    const stale = new Map<string, ItemUnits>()
    for (let i = 0; i < unique.length; i += 500) {
      const { data } = await admin.from("comp_items").select("item_id, sold_qty, created_on, ended, fetched_at").in("item_id", unique.slice(i, i + 500))
      for (const r of data ?? []) {
        const u = { soldQty: r.sold_qty, createdOn: r.created_on, ended: r.ended }
        // Anything still selling is read again daily: its count's daily change is what it sold.
        if (!r.ended && Date.now() - Date.parse(r.fetched_at) > LIVE_TTL_MS) stale.set(r.item_id, u)
        else out.set(r.item_id, u)
      }
    }
    if (!fetch) {
      for (const [id, u] of stale) out.set(id, u)
      return out
    }
    // Live listings first (they're where multi-unit sales sit), then the newest sold ones.
    const todo = unique.filter((id) => !out.has(id)).sort((a, b) => Number(live.has(b)) - Number(live.has(a)))
    if (!todo.length || !process.env.EBAY_CLIENT_ID) return out
    const budget = Math.min(cap, dailyLimit() - (await spend(0)))
    if (budget <= 0) {
      console.warn("[comp units] daily limit reached", dailyLimit())
      return out
    }
    const token = await getAppToken()
    let calls = 0
    const save = async (rows: { id: string; units: ItemUnits }[]) => {
      for (const r of rows) out.set(r.id, r.units)
      if (!rows.length) return
      await admin.from("comp_items").upsert(
        rows.map((r) => ({ item_id: r.id, sold_qty: r.units.soldQty, created_on: r.units.createdOn, ended: r.units.ended, fetched_at: new Date().toISOString() })),
        { onConflict: "item_id" },
      )
      // Today's reading of each count (one per listing per day; the latest wins).
      const day = etDay(new Date())
      const counts = rows.filter((r) => r.units.soldQty != null).map((r) => ({ item_id: r.id, day, sold_qty: r.units.soldQty! }))
      if (counts.length) {
        const { error } = await admin.from("comp_item_counts").upsert(counts, { onConflict: "item_id,day" })
        if (error) console.error("[comp units] counts", error)
      }
    }
    // Batches of 20 (getItems) while eBay allows it for this keyset.
    let next = 0
    while (!batchDenied && next < todo.length && calls < budget) {
      const batch = todo.slice(next, next + 20)
      calls++
      try {
        const res = await ebayFetch<{ items?: Item[] }>(token, `/buy/browse/v1/item/?item_ids=${batch.map((id) => `v1|${id}|0`).join(",")}`)
        const got = (res.items ?? []).map((x) => toItemUnits(x)).filter((x): x is { id: string; units: ItemUnits } => !!x)
        const found = new Set(got.map((g) => g.id))
        // Not returned: ended or removed, or a multi-variation listing. One unit, and don't ask again.
        const gone = batch.filter((id) => !found.has(id) && !live.has(id)).map((id) => ({ id, units: { soldQty: null, createdOn: null, ended: true } }))
        await save([...got, ...gone])
        next += 20
      } catch (e) {
        // getItems is a restricted API (403 for our keyset): one call per listing from here on.
        if (!(e instanceof EbayError) || (e.status !== 403 && e.status !== 400)) throw e
        batchDenied = true
      }
    }
    // One call per listing, several at once, live listings first.
    const single = todo.slice(next, next + Math.max(0, budget - calls))
    calls += single.length
    for (let i = 0; i < single.length; i += PARALLEL) {
      const rows = await Promise.all(
        single.slice(i, i + PARALLEL).map(async (id) => {
          try {
            return toItemUnits(await ebayFetch<Item>(token, `/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${id}`))
          } catch (err) {
            // Ended or removed (404), or a multi-variation listing (11006): one unit.
            if (err instanceof EbayError && (err.status === 404 || err.has(11006) || err.status === 400))
              return { id, units: { soldQty: null, createdOn: null, ended: !live.has(id) } }
            console.error("[comp units] item", id, err)
            return null
          }
        }),
      )
      await save(rows.filter((r): r is { id: string; units: ItemUnits } => !!r))
    }
    await spend(calls)
    console.log("[comp units]", JSON.stringify({ asked: todo.length, calls, known: out.size }))
  } catch (e) {
    console.error("[comp units]", e)
  }
  return out
}

/** Daily readings of these listings' sold counts over the last 95 days (for reconcileUnits). Never throws. */
export async function loadUnitHistory(ids: string[]): Promise<UnitHistory> {
  const out: UnitHistory = new Map()
  const unique = [...new Set(ids.filter((id) => /^\d{9,15}$/.test(id)))]
  if (!unique.length) return out
  const since = etDay(new Date(Date.now() - 95 * 86_400_000))
  const admin = createAdminClient()
  try {
    for (let i = 0; i < unique.length; i += 300) {
      const { data, error } = await admin
        .from("comp_item_counts")
        .select("item_id, day, sold_qty")
        .in("item_id", unique.slice(i, i + 300))
        .gte("day", since)
        .limit(30_000)
      if (error) throw error
      for (const r of data ?? []) out.set(r.item_id, [...(out.get(r.item_id) ?? []), { day: r.day, qty: r.sold_qty }])
    }
  } catch (e) {
    console.error("[comp units] history", e)
  }
  return out
}
