import "server-only"
import { EbayError, ebayConfig, ebayFetch } from "@/lib/marketplaces/ebay/client"
import { getAppToken } from "@/lib/marketplaces/ebay/oauth"
import { UserError } from "@/lib/errors"
import { createAdminClient } from "@/lib/supabase/admin"
import { todayET } from "./days"
import { matchExclusion, type Profile } from "./profile"
import { specificsVerdict, versionHits } from "./metrics"

// eBay Browse API for research. One app-level quota (5,000 calls/day by default) is
// shared by every FlipLedger user, so every call is counted and the pipeline checks
// the remaining budget before spending it.

export const EBAY_DAILY_BUDGET = Number(process.env.RESEARCH_EBAY_DAILY_BUDGET ?? 5000)

export type Summary = {
  itemId: string
  legacyItemId?: string
  title: string
  price?: { value: string; currency: string }
  shippingOptions?: { shippingCost?: { value: string } }[]
  condition?: string
  categories?: { categoryName: string }[]
  image?: { imageUrl: string }
  thumbnailImages?: { imageUrl: string }[]
  itemWebUrl?: string
  seller?: { username?: string; feedbackScore?: number }
  buyingOptions?: string[]
  currentBidPrice?: { value: string }
  itemEndDate?: string
  itemCreationDate?: string
}

export type ItemDetail = {
  title?: string
  localizedAspects?: { name: string; value: string }[]
  estimatedAvailabilities?: { estimatedSoldQuantity?: number; estimatedAvailableQuantity?: number }[]
  price?: { value: string; currency?: string }
  image?: { imageUrl: string }
  itemCreationDate?: string
  itemEndDate?: string
}
export type GroupCache = Record<string, { items?: ItemDetail[] }>

export const sumPrice = (s: Summary) => Number(s.price?.value ?? s.currentBidPrice?.value ?? NaN)
export const sumShip = (s: Summary) => Number(s.shippingOptions?.[0]?.shippingCost?.value ?? 0)
export const aspects = (d: ItemDetail) => Object.fromEntries((d.localizedAspects ?? []).map((a) => [a.name, a.value]))

export async function bumpUsage(kind: string, model: string, calls: number, inTok = 0, outTok = 0, cost = 0) {
  await createAdminClient().rpc("research_bump_usage", {
    _day: todayET(), _kind: kind, _model: model, _calls: calls, _in: Math.round(inTok), _out: Math.round(outTok), _cost: cost,
  })
}

export async function ebayCallsToday() {
  const { data } = await createAdminClient().from("research_api_usage").select("calls").eq("day", todayET()).eq("kind", "ebay")
  return (data ?? []).reduce((s, r) => s + (r.calls ?? 0), 0)
}

async function browse<T>(path: string): Promise<T> {
  if (ebayConfig().sandbox) throw new UserError("Research needs FlipLedger's production eBay keys (EBAY_ENV=production).")
  const token = await getAppToken()
  try {
    return await ebayFetch<T>(token, `/buy/browse/v1/${path}`)
  } finally {
    await bumpUsage("ebay", path.split("?")[0] ?? path, 1)
  }
}

export async function ebaySearch(q: string, offset = 0, limit = 200) {
  const j = await browse<{ itemSummaries?: Summary[]; total?: number }>(
    `item_summary/search?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`,
  )
  return { items: j.itemSummaries ?? [], total: j.total ?? 0 }
}

const itemByLegacy = (id: string) => browse<ItemDetail>(`item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(id)}`)
const itemGroup = (id: string) => browse<{ items?: ItemDetail[] }>(`item/get_items_by_item_group?item_group_id=${encodeURIComponent(id)}`)

/** HTTP status of an eBay failure (0 when it isn't one). */
export const ebayStatus = (e: unknown) => (e instanceof EbayError ? e.status : 0)

/**
 * Pick the variation of a multi-variation listing that matches the version. If every
 * variation is this version, sum their quantities; otherwise count it as a single unit.
 */
export function selectGroup(items: ItemDetail[], key: string, profile: Profile): { detail: ItemDetail; reason: string | null } {
  const valid = (d: ItemDetail) => !matchExclusion(d.title ?? "", profile) && specificsVerdict(aspects(d), key, profile)?.verdict !== "review"
  const only = (d: ItemDetail) => {
    const hits = versionHits(aspects(d), d.title ?? "", profile)
    return hits.length === 1 ? hits[0]!.key : null
  }
  const matched = items.filter((d) => valid(d) && only(d) === key)
  if (matched.length === 1) return { detail: matched[0]!, reason: null }
  if (items.length && items.every((d) => valid(d) && only(d) === key)) {
    const sum = (f: "estimatedSoldQuantity" | "estimatedAvailableQuantity") =>
      items.reduce((n, d) => n + Number(d.estimatedAvailabilities?.[0]?.[f] ?? 0), 0)
    return {
      detail: {
        ...items[0]!,
        estimatedAvailabilities: [{ estimatedSoldQuantity: sum("estimatedSoldQuantity"), estimatedAvailableQuantity: sum("estimatedAvailableQuantity") }],
        itemCreationDate: items.map((d) => d.itemCreationDate).filter((s): s is string => !!s).sort()[0],
      },
      reason: null,
    }
  }
  return { detail: { estimatedAvailabilities: [{ estimatedSoldQuantity: 1 }] }, reason: "Multi-variation listing, variation not matched" }
}

// eBay's getItems (up to 20 listings per call) is a limited-release method; if this app's
// keyset isn't allowed to use it, remember that for this instance and use single calls.
let batchDisabled = false

/**
 * Details for up to 20 listings in one call (Browse getItems), keyed by legacy ID.
 * Listings it doesn't return (item groups, ended, errors) are left for single calls.
 */
export async function itemsByLegacyBatch(legacyIds: string[]): Promise<Map<string, ItemDetail>> {
  const out = new Map<string, ItemDetail>()
  if (batchDisabled || legacyIds.length < 2) return out
  for (let i = 0; i < legacyIds.length; i += 20) {
    const ids = legacyIds.slice(i, i + 20)
    try {
      const j = await browse<{ items?: (ItemDetail & { legacyItemId?: string; itemId?: string })[] }>(
        `item?item_ids=${ids.map((id) => encodeURIComponent(`v1|${id}|0`)).join(",")}`,
      )
      for (const d of j.items ?? []) {
        const legacy = d.legacyItemId ?? d.itemId?.split("|")[1]
        if (legacy) out.set(legacy, d)
      }
    } catch (e) {
      if (e instanceof EbayError && [403, 404, 405].includes(e.status)) {
        console.warn("research: eBay getItems isn't available for this keyset; using single calls", e.message)
        batchDisabled = true
        return out
      }
      throw e
    }
  }
  return out
}

/** Item details by legacy ID, falling back to the item group for multi-variation listings (error 11006). */
export function detailReader(profile: Profile, cache: GroupCache, prefetched = new Map<string, ItemDetail>()) {
  const pending = new Map<string, Promise<{ items?: ItemDetail[] }>>()
  return async (id: string, key: string) => {
    const hit = prefetched.get(id)
    if (hit) return { detail: hit, reason: null as string | null }
    try {
      return { detail: await itemByLegacy(id), reason: null as string | null }
    } catch (e) {
      if (!(e instanceof EbayError) || !e.has(11006)) throw e
      let group = e.param("item_group_id") ?? e.param("itemGroupId")
      const href = e.param("itemGroupHref")
      if (href) {
        try {
          group = new URL(href).searchParams.get("item_group_id") ?? group
        } catch {
          // keep the parameter value
        }
      }
      if (!group) return selectGroup([], key, profile)
      if (!cache[group]) {
        let request = pending.get(group)
        if (!request) {
          request = itemGroup(group)
          pending.set(group, request)
        }
        cache[group] = await request
      }
      return selectGroup(cache[group]?.items ?? [], key, profile)
    }
  }
}

/** Run fn over items with at most `limit` in flight. */
export async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i]!, i)
      }
    }),
  )
  return out
}
