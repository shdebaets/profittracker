// eBay sold listings from a data provider (OpenWeb Ninja's Real-Time eBay Data API), for when no
// seller with the extension has read a product recently. eBay has shown sold searches only to
// signed-in members since 22 July 2026, so servers can't read them directly.
// One request = one page of up to 60 sold listings (up to SOLD_DATA_MAX_PAGES, default 4, for busy products). Results are cached 12 hours per search and
// shared by everyone, and there's a daily cap (SOLD_DATA_DAILY_LIMIT, default 300 requests).
import "server-only"
import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { queryKey } from "./stats"

export const SOLD_TTL_MS = 12 * 60 * 60_000
const ENDPOINT = "https://api.openwebninja.com/real-time-ebay-data/search"
const dailyLimit = () => Number(process.env.SOLD_DATA_DAILY_LIMIT) || 300

export type SoldRow = {
  external_id: string
  title: string
  price_cents: number
  shipping_cents: number | null
  sold_on: string
  best_offer: boolean
  condition: string | null
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

/** "Sold Jul 28, 2026" / "Sold  28 Jul 2026" → "2026-07-28". Pure. */
export function soldDate(text: unknown): string | null {
  const s = String(text ?? "").toLowerCase()
  let m = s.match(/([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/)
  if (m && MONTHS.includes(m[1])) return `${m[3]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`
  m = s.match(/(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})/)
  if (m && MONTHS.includes(m[2])) return `${m[3]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** "$1,234.50", 1234.5, {value: 1234.5} → cents. Pure. */
export function moneyCents(v: unknown): number | null {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>
    return moneyCents(o.value ?? o.extracted ?? o.amount ?? o.raw ?? null)
  }
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null
  const m = String(v ?? "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/)
  return m ? Math.round(Number(m[1]) * 100) : null
}

/** Shipping text → cents: "Free delivery" = 0, "+$5.99 shipping" = 599, unknown = null. Pure. */
export function shippingCents(v: unknown): number | null {
  if (v == null || v === "") return null
  if (typeof v === "string" && /free/i.test(v)) return 0
  return moneyCents(v)
}

const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (o[k] != null && o[k] !== "") return o[k]
  return null
}

/** One provider result → a comp_sales row, or null when it isn't a priced sale. Pure. */
export function toSoldRow(raw: unknown): SoldRow | null {
  if (!raw || typeof raw !== "object") return null
  const p = raw as Record<string, unknown>
  const title = String(pick(p, "title", "name", "product_title") ?? "").trim()
  const currency = String(pick(p, "currency") ?? "USD").toUpperCase()
  const price = moneyCents(pick(p, "price", "sold_price", "sale_price"))
  const sold = soldDate(pick(p, "caption", "sold_date", "date_sold", "sold_on", "subtitle"))
  if (!title || !price || price <= 0 || currency !== "USD" || !sold) return null
  const url = String(pick(p, "product_url", "url", "link", "item_url") ?? "")
  const id =
    String(pick(p, "product_id", "item_id", "id", "itemId") ?? "").match(/\d{9,15}/)?.[0] ??
    url.match(/\/itm\/(?:[^/]*\/)?(\d{9,15})/)?.[0].match(/\d{9,15}/)?.[0] ??
    // No id: a stable one from what makes the sale unique, so re-reads don't duplicate it.
    "h" + createHash("sha256").update(`${title}|${price}|${sold}`).digest("hex").slice(0, 14)
  const format = String(pick(p, "buying_format", "format") ?? "")
  return {
    external_id: id,
    title: title.slice(0, 200),
    price_cents: price,
    shipping_cents: shippingCents(pick(p, "shipping", "shipping_price", "shipping_cost", "delivery")),
    sold_on: sold,
    best_offer:
      /best.?offer/i.test(format) ||
      /best offer accepted/i.test(String(pick(p, "caption") ?? "")) ||
      /best offer accepted/i.test(String(pick(p, "price_raw") ?? "")),
    condition: (pick(p, "condition", "item_condition") as string | null)?.toString().slice(0, 60) ?? null,
  }
}

export class SoldApiError extends Error {}

async function fetchPage(query: string, page: number): Promise<{ items: unknown[]; total: number | null }> {
  const key = process.env.SOLD_DATA_API_KEY?.trim()
  if (!key) throw new SoldApiError("SOLD_DATA_API_KEY is not set")
  const params = new URLSearchParams({ query: query.slice(0, 100), show_only: "sold_items", sort_by: "RECENTLY_SOLD", domain: "com", page: String(page) })
  const res = await fetch(`${ENDPOINT}?${params}`, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(25_000) })
  const body = (await res.json().catch(() => ({}))) as { data?: { products?: unknown[] } | unknown[]; error?: unknown; message?: unknown }
  if (!res.ok) throw new SoldApiError(`sold data ${res.status}: ${String(body.message ?? body.error ?? "").slice(0, 200)}`)
  const data = body.data as ({ products?: unknown[] } & Record<string, unknown>) | unknown[] | undefined
  if (page === 1 && data && !Array.isArray(data)) console.log("[sold data] response keys", Object.keys(data).join(","))
  const items = Array.isArray(data) ? data : (data?.products ?? [])
  const totalRaw = Array.isArray(data) ? null : (data?.total_results ?? data?.total ?? data?.total_products ?? null)
  const total = typeof totalRaw === "number" ? totalRaw : Number(String(totalRaw ?? "").replace(/[^\d]/g, "")) || null
  return { items, total }
}

const MAX_PAGES = () => Number(process.env.SOLD_DATA_MAX_PAGES) || 4

/**
 * Reads sold listings for a search into comp_sales (shared) unless this search was read in the
 * last 12 hours or the daily cap is used up. Returns how many rows it saved (0 when skipped).
 * Never throws: comps still work from live listings if the provider is down.
 */
export async function refreshSoldFromApi(query: string): Promise<number> {
  if (!process.env.SOLD_DATA_API_KEY?.trim()) return 0
  const admin = createAdminClient()
  // v2: reads several pages (v1 read one, which undercounted busy products).
  const key = `sold4:${queryKey(query)}`
  const { data: last } = await admin.from("comp_cache").select("fetched_at").eq("key", key).maybeSingle()
  if (last && Date.now() - Date.parse(last.fetched_at) < SOLD_TTL_MS) return 0
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const { data: today } = await admin.from("comp_cache").select("payload").like("key", "sold%").gte("fetched_at", since).limit(5000)
  const used = (today ?? []).reduce((n, r) => n + (Number((r.payload as { requests?: number })?.requests) || 1), 0)
  if (used >= dailyLimit()) {
    console.warn("[sold data] daily limit reached", dailyLimit())
    return 0
  }
  try {
    // Newest sales first; keep paging while a full page is still inside the last 30 days, so busy
    // products get a real 30-day count. Slow products stop after one page.
    const rows: SoldRow[] = []
    let requests = 0
    let total: number | null = null
    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
    for (let page = 1; page <= MAX_PAGES(); page++) {
      const res = await fetchPage(query, page)
      requests++
      total ??= res.total
      if (page === 1)
        // What the provider sends for prices and formats: to tell best-offer sales apart.
        console.log(
          "[sold data] sample",
          JSON.stringify(
            res.items.slice(0, 12).map((x) => {
              const o = x as Record<string, unknown>
              return { t: String(o.title ?? "").slice(0, 40), p: o.price, pr: o.price_raw, op: o.original_price, d: o.discount, bf: o.buying_format, c: o.caption, s: o.shipping }
            }),
          ),
        )
      const got = res.items.map(toSoldRow).filter((r): r is SoldRow => !!r)
      rows.push(...got)
      const oldest = got.map((r) => r.sold_on).sort()[0]
      if (res.items.length < 60 || !oldest || oldest < monthAgo) break
    }
    // Pages can overlap while new sales come in: one row per sale, or the upsert refuses the batch.
    const unique = [...new Map(rows.map((r) => [r.external_id, r])).values()]
    const qk = queryKey(query)
    if (unique.length) {
      const { error } = await admin.from("comp_sales").upsert(
        unique.map((r) => ({ ...r, query_key: qk, collected_at: new Date().toISOString() })),
        { onConflict: "query_key,external_id" },
      )
      if (error) throw error
    }
    // Only mark it read once it's saved, so a failure is retried on the next lookup.
    await admin.from("comp_cache").upsert({ key, payload: { requests, results: unique.length, total }, fetched_at: new Date().toISOString() })
    return unique.length
  } catch (e) {
    console.error("[sold data]", e)
    return 0
  }
}
