// Units per eBay listing (CompAmp's details step). eBay's sold search shows a multi-quantity
// listing once, however many units it sold, so counting search results undercounts busy products
// badly (Pokémon UPC Night: 688 listings, 1,851 units). The Browse API's item details carry
// estimatedSoldQuantity: read it once per listing (shared in comp_items) and count units.
// Ended listings may have no details any more; they count as 1, which is right for most of them.
import "server-only"
import { EbayError, ebayFetch } from "@/lib/marketplaces/ebay/client"
import { getAppToken } from "@/lib/marketplaces/ebay/oauth"
import { createAdminClient } from "@/lib/supabase/admin"

export type ItemUnits = { soldQty: number | null; createdOn: string | null; ended: boolean }

type Item = {
  itemId?: string
  legacyItemId?: string
  itemCreationDate?: string
  itemEndDate?: string
  estimatedAvailabilities?: { estimatedSoldQuantity?: number; estimatedAvailabilityStatus?: string }[]
}

const LIVE_TTL_MS = 24 * 60 * 60_000
const maxCalls = () => Number(process.env.COMP_UNITS_MAX_CALLS) || 40
const dailyLimit = () => Number(process.env.COMP_UNITS_DAILY_LIMIT) || 2000

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

async function spend(calls: number): Promise<number> {
  const admin = createAdminClient()
  const key = `units-calls:${new Date().toISOString().slice(0, 10)}`
  const { data } = await admin.from("comp_cache").select("payload").eq("key", key).maybeSingle()
  const used = Number((data?.payload as { calls?: number })?.calls ?? 0)
  if (calls) await admin.from("comp_cache").upsert({ key, payload: { calls: used + calls, requests: 0 }, fetched_at: new Date().toISOString() })
  return used
}

/**
 * Units for these listings: cached ones from comp_items, the rest from the Browse API (20 a call,
 * at most COMP_UNITS_MAX_CALLS calls per lookup and COMP_UNITS_DAILY_LIMIT a day; whatever's left
 * waits for the next lookup and counts as 1 meanwhile). `live`: ids of listings still for sale,
 * whose counts are re-read daily. Never throws.
 */
export async function loadUnits(ids: string[], live: Set<string> = new Set()): Promise<Map<string, ItemUnits>> {
  const out = new Map<string, ItemUnits>()
  const unique = [...new Set(ids.filter((id) => /^\d{9,15}$/.test(id)))]
  if (!unique.length) return out
  const admin = createAdminClient()
  try {
    for (let i = 0; i < unique.length; i += 500) {
      const { data } = await admin.from("comp_items").select("item_id, sold_qty, created_on, ended, fetched_at").in("item_id", unique.slice(i, i + 500))
      for (const r of data ?? []) {
        const stale = !r.ended && live.has(r.item_id) && Date.now() - Date.parse(r.fetched_at) > LIVE_TTL_MS
        if (!stale) out.set(r.item_id, { soldQty: r.sold_qty, createdOn: r.created_on, ended: r.ended })
      }
    }
    // Live listings first (they're where multi-unit sales sit), then the newest sold ones.
    const todo = unique.filter((id) => !out.has(id)).sort((a, b) => Number(live.has(b)) - Number(live.has(a)))
    if (!todo.length || !process.env.EBAY_CLIENT_ID) return out
    const budget = Math.min(maxCalls(), dailyLimit() - (await spend(0)))
    if (budget <= 0) {
      console.warn("[comp units] daily limit reached", dailyLimit())
      return out
    }
    const token = await getAppToken()
    let calls = 0
    const save = async (rows: { id: string; units: ItemUnits }[]) => {
      for (const r of rows) out.set(r.id, r.units)
      if (rows.length)
        await admin.from("comp_items").upsert(
          rows.map((r) => ({ item_id: r.id, sold_qty: r.units.soldQty, created_on: r.units.createdOn, ended: r.units.ended, fetched_at: new Date().toISOString() })),
          { onConflict: "item_id" },
        )
    }
    for (let i = 0; i < todo.length && calls < budget; i += 20) {
      const batch = todo.slice(i, i + 20)
      calls++
      try {
        const res = await ebayFetch<{ items?: Item[] }>(token, `/buy/browse/v1/item/?item_ids=${batch.map((id) => `v1|${id}|0`).join(",")}`)
        const got = (res.items ?? []).map((x) => toItemUnits(x)).filter((x): x is { id: string; units: ItemUnits } => !!x)
        const found = new Set(got.map((g) => g.id))
        // Not returned: ended or removed, or a multi-variation listing. One unit, and don't ask again.
        const gone = batch.filter((id) => !found.has(id) && !live.has(id)).map((id) => ({ id, units: { soldQty: null, createdOn: null, ended: true } }))
        await save([...got, ...gone])
      } catch (e) {
        // getItems not allowed for this keyset: fall back to one call per listing, live ones first.
        if (!(e instanceof EbayError) || (e.status !== 403 && e.status !== 400)) throw e
        for (const id of batch) {
          if (calls >= budget) break
          calls++
          try {
            const item = await ebayFetch<Item>(token, `/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${id}`)
            const u = toItemUnits(item)
            await save(u ? [u] : [])
          } catch (err) {
            if (err instanceof EbayError && (err.status === 404 || err.has(11006) || err.status === 400))
              await save([{ id, units: { soldQty: null, createdOn: null, ended: !live.has(id) } }])
            else throw err
          }
        }
      }
    }
    await spend(calls)
    console.log("[comp units]", JSON.stringify({ asked: todo.length, calls, known: out.size }))
  } catch (e) {
    console.error("[comp units]", e)
  }
  return out
}
