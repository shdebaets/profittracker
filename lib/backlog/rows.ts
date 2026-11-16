// One spreadsheet row → one FlipLedger item or expense, or the reason it can't be.
// Pure: no I/O. The server action validates the result again before saving.
import { EXPENSE_CATEGORIES, type Platform } from "@/lib/types"
import type { MarketplaceId } from "@/lib/marketplaces/registry"
import { FEE_PRESETS, mileageDeduction, presetFor } from "@/lib/profit"
import type { ExpenseField, ItemField, Mapping } from "./columns"
import { parseDate, parseMoney, parsePercent, parseQty, parseYes } from "./values"

export type ItemRow = {
  title: string
  status: "inventory" | "sold" | "returned"
  quantity: number
  cost_cents: number
  cost_unknown: boolean
  purchased_at: string
  store: string | null
  link_url: string | null
  description: string | null
  brand: string | null
  size: string | null
  category: string | null
  list_price_cents: number | null
  sale_price_cents: number | null
  buyer_shipping_cents: number
  label_cost_cents: number
  fee_pct: number
  fee_fixed_cents: number
  sales_tax_cents: number
  platform: Platform | null
  sold_on: MarketplaceId | null
  sold_at: string | null
  shipped_at: string | null
  import_ref: string
}

export type ExpenseRow = {
  kind: "expense" | "mileage"
  title: string
  category: string
  amount_cents: number
  spent_at: string
  miles: number | null
  rate_cents: number | null
  import_ref: string
}

export type RowResult<T> = { ok: true; row: T } | { ok: false; line: number; reason: string }

const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s)
const text = (s: string, max: number) => cut(s.trim().replace(/\s+/g, " "), max) || null

/** Fee preset and marketplace for "eBay", "Posh", "FB Marketplace", "13.25% eBay Std"… */
export function platformFrom(raw: string): { platform: Platform; soldOn: MarketplaceId | null } | null {
  const t = raw.trim().toLowerCase()
  if (!t) return null
  const preset = FEE_PRESETS.find((p) => p.label.toLowerCase() === t || p.id === t)
  if (preset) {
    const soldOn: Partial<Record<Platform, MarketplaceId>> = { ebay: "ebay", facebook: "facebook" }
    return { platform: preset.id, soldOn: soldOn[preset.id] ?? null }
  }
  const has = (re: RegExp) => re.test(t)
  if (has(/local|cash|in person|in-person|craigslist|offer ?up|garage|yard sale|pick ?up|meet ?up/)) return { platform: "cash", soldOn: null }
  if (has(/ebay/)) return { platform: "ebay", soldOn: "ebay" }
  if (has(/posh/)) return { platform: "poshmark_amz", soldOn: "poshmark" }
  if (has(/mercari/)) return { platform: "mercari_depop", soldOn: "mercari" }
  if (has(/depop/)) return { platform: "mercari_depop", soldOn: "depop" }
  if (has(/facebook|\bfb\b|fbmp|meta/)) return { platform: "facebook", soldOn: "facebook" }
  if (has(/vinted/)) return { platform: "custom", soldOn: "vinted" }
  if (has(/etsy/)) return { platform: "custom", soldOn: "etsy" }
  if (has(/amazon|\bamz\b|\bfba\b/)) return { platform: "poshmark_amz", soldOn: null }
  if (has(/paypal|stripe|square|venmo|card/)) return { platform: "card", soldOn: null }
  return { platform: "custom", soldOn: null }
}

type Status = ItemRow["status"]
function statusFrom(raw: string): Status | null | undefined {
  const t = raw.trim().toLowerCase()
  if (!t) return null
  if (/return|refund/.test(t)) return "returned"
  if (/unsold|not sold|in stock|stock|inventory|active|listed|available|for sale|draft|unlisted|hold/.test(t) || /^(n|no|false|0)$/.test(t)) return "inventory"
  if (/sold|shipped|complete|delivered|paid/.test(t) || parseYes(t)) return "sold"
  return undefined
}

/** Loosely match a category to FlipLedger's expense categories. */
export function expenseCategory(raw: string, title = ""): string {
  const t = raw.trim().toLowerCase()
  const exact = EXPENSE_CATEGORIES.find((c) => c.toLowerCase() === t)
  if (exact) return exact
  const s = `${t} ${title.toLowerCase()}`
  const rules: [RegExp, (typeof EXPENSE_CATEGORIES)[number]][] = [
    [/packag|box|tape|bubble|poly ?mailer|tissue|bag/, "Packaging"],
    [/ship|mailer|postage|label|usps|ups|fedex|pirate/, "Shipping Supplies"],
    [/software|subscription|app\b|vendoo|list perfectly|crosslist|primelister|flyp|saas/, "Software"],
    [/fee|ebay|poshmark|mercari|depop|store subscription/, "Platform Fees"],
    [/storage|unit|rent|warehouse/, "Storage"],
    [/equip|printer|scale|camera|light|computer|laptop|phone|tool|rack|hanger|mannequin/, "Equipment"],
    [/gas|fuel|travel|hotel|flight|uber|lyft|parking|toll|car/, "Travel"],
    [/meal|food|lunch|dinner|breakfast|coffee|restaurant/, "Meals"],
  ]
  return rules.find(([re]) => re.test(s))?.[1] ?? "Other"
}

/**
 * Stable IDs for imported rows: a hash of what the row says, plus how many identical
 * rows came before it in the file (two of the same thing bought twice stay two items).
 * Importing the same file again gives the same IDs, so those rows are skipped.
 */
export function makeRefs() {
  const seen = new Map<string, number>()
  return (kind: string, parts: unknown[]) => {
    const key = `${kind}|${parts.map((p) => (p === null || p === undefined ? "" : String(p))).join("|")}`
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    return `${kind}:${hash(`${key}#${n}`)}`
  }
}

/** cyrb53, twice with different seeds: 106 bits, plenty for one seller's rows. */
function hash(str: string): string {
  const one = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed
    let h2 = 0x41c6ce57 ^ seed
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i)
      h1 = Math.imul(h1 ^ ch, 2654435761)
      h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
  }
  return `${one(1)}${one(2)}`
}

type Ref = ReturnType<typeof makeRefs>

/** `line` is the spreadsheet's own row number, for messages. */
export function mapItemRow(cells: string[], m: Mapping<ItemField>, line: number, ref: Ref, now = new Date()): RowResult<ItemRow> {
  const get = (f: ItemField) => (m[f] >= 0 ? (cells[m[f]] ?? "").trim() : "")
  const bad = (reason: string): RowResult<ItemRow> => ({ ok: false, line, reason })
  const money = (f: ItemField, label: string) => {
    const v = parseMoney(get(f))
    if (v === undefined) throw new Error(`${label} "${cut(get(f), 20)}" isn't an amount`)
    return v
  }
  const date = (f: ItemField, label: string) => {
    const v = parseDate(get(f))
    if (v === undefined) throw new Error(`${label} "${cut(get(f), 20)}" isn't a date`)
    return v
  }

  const title = text(get("title"), 200)
  if (!title) return bad("no item name")
  const quantity = parseQty(get("quantity"))
  if (quantity === undefined) return bad(`quantity "${cut(get("quantity"), 20)}" isn't a whole number`)

  try {
    const cost = money("cost", "cost")
    const totalCost = money("totalCost", "total cost")
    const salePrice = money("salePrice", "sale price")
    const saleTotal = money("saleTotal", "total sale")
    const buyerShipping = money("buyerShipping", "buyer shipping") ?? 0
    // Fees are dollars ("$4.21") or a rate ("13.25%").
    const feeRate = get("fees").includes("%") ? parsePercent(get("fees")) : null
    if (feeRate === undefined) return bad(`fees "${cut(get("fees"), 20)}" isn't an amount or a %`)
    const fees = feeRate === null ? money("fees", "fees") : null
    const labelCost = money("labelCost", "label cost") ?? 0
    const salesTax = money("salesTax", "sales tax") ?? 0
    const listPrice = money("listPrice", "list price")
    const purchasedAt = date("purchasedAt", "purchase date")
    // A "Sold" column of yes/no is a status, not a date.
    const soldRaw = get("soldAt")
    const soldFlag = soldRaw && parseDate(soldRaw) === undefined ? statusFrom(soldRaw) : null
    const soldAt = soldFlag !== null && soldFlag !== undefined ? null : date("soldAt", "sold date")

    const explicit = statusFrom(get("status"))
    if (explicit === undefined) return bad(`status "${cut(get("status"), 20)}" isn't sold, in stock or returned`)
    const price = salePrice ?? (saleTotal !== null ? Math.round(Math.max(0, saleTotal - buyerShipping) / quantity) : null)
    const status: Status =
      explicit ?? soldFlag ?? (soldAt ? "sold" : m.soldAt < 0 && m.status < 0 && price !== null && price > 0 ? "sold" : "inventory")

    const unitCost = cost ?? (totalCost !== null ? Math.round(totalCost / quantity) : null)
    const base = {
      title,
      quantity,
      cost_cents: unitCost ?? 0,
      cost_unknown: unitCost === null,
      store: text(get("store"), 100),
      link_url: /^https?:\/\/\S+$/i.test(get("link")) ? cut(get("link"), 1000) : null,
      description: text(get("notes"), 5000),
      brand: text(get("brand"), 100),
      size: text(get("size"), 50),
      category: text(get("category"), 200),
      list_price_cents: listPrice,
    }

    if (status !== "sold") {
      const row = {
        ...base, status, purchased_at: purchasedAt ?? now.toISOString(),
        sale_price_cents: null, buyer_shipping_cents: 0, label_cost_cents: 0, fee_pct: 0, fee_fixed_cents: 0,
        sales_tax_cents: 0, platform: null, sold_on: null, sold_at: null, shipped_at: null,
      }
      return { ok: true, row: { ...row, import_ref: ref("item", [title, status, quantity, row.cost_cents, base.cost_unknown, row.purchased_at.slice(0, 10), base.store, listPrice]) } }
    }

    if (!soldAt) return bad("sold, but there's no sold date")
    if (price === null) return bad("sold, but there's no sale price")
    const plat = platformFrom(get("platform"))
    // Their real fees when the sheet has them; else the platform's usual rate.
    const preset = presetFor(plat?.platform ?? "cash")
    const [feePct, feeFixed] =
      fees !== null ? [0, fees] : feeRate !== null ? [feeRate, 0] : plat ? [preset.pct, preset.fixedCents] : [0, 0]
    const row: ItemRow = {
      ...base,
      status,
      purchased_at: purchasedAt ?? soldAt,
      sale_price_cents: price,
      buyer_shipping_cents: buyerShipping,
      label_cost_cents: labelCost,
      fee_pct: feePct,
      fee_fixed_cents: feeFixed,
      sales_tax_cents: salesTax,
      platform: plat?.platform ?? "cash",
      sold_on: plat?.soldOn ?? null,
      sold_at: soldAt,
      // Old sales shipped long ago; don't fill the To Ship list.
      shipped_at: soldAt,
      import_ref: "",
    }
    row.import_ref = ref("item", [title, status, quantity, row.cost_cents, base.cost_unknown, row.purchased_at.slice(0, 10), soldAt.slice(0, 10), price, buyerShipping, get("fees"), labelCost, get("platform").toLowerCase()])
    return { ok: true, row }
  } catch (e) {
    return bad(e instanceof Error ? e.message : "couldn't read this row")
  }
}

export function mapExpenseRow(cells: string[], m: Mapping<ExpenseField>, line: number, ref: Ref, mileageRateCents: number): RowResult<ExpenseRow> {
  const get = (f: ExpenseField) => (m[f] >= 0 ? (cells[m[f]] ?? "").trim() : "")
  const bad = (reason: string): RowResult<ExpenseRow> => ({ ok: false, line, reason })

  const amount = parseMoney(get("amount"))
  if (amount === undefined) return bad(`amount "${cut(get("amount"), 20)}" isn't an amount`)
  const date = parseDate(get("date"))
  if (date === undefined) return bad(`date "${cut(get("date"), 20)}" isn't a date`)
  if (date === null) return bad("no date")
  const milesRaw = get("miles").replace(/,/g, "").replace(/\s*mi(les)?$/i, "")
  const miles = milesRaw ? Number(milesRaw) : null
  if (miles !== null && !(miles > 0 && miles <= 10_000)) return bad(`miles "${cut(get("miles"), 20)}" isn't a distance`)

  const desc = text(get("title"), 200)
  if (amount === null && miles !== null) {
    const title = cut(`Mileage: ${desc ?? "Business drive"}`, 200)
    const row: ExpenseRow = {
      kind: "mileage", title, category: "Travel", amount_cents: mileageDeduction(miles, mileageRateCents),
      spent_at: date, miles: Math.round(miles * 10) / 10, rate_cents: mileageRateCents, import_ref: "",
    }
    row.import_ref = ref("mileage", [title, date.slice(0, 10), row.miles])
    return { ok: true, row }
  }
  if (amount === null) return bad("no amount")
  const category = expenseCategory(get("category"), desc ?? "")
  const title = desc ?? (get("category").trim() ? cut(get("category").trim(), 200) : category)
  const row: ExpenseRow = { kind: "expense", title, category, amount_cents: amount, spent_at: date, miles: null, rate_cents: null, import_ref: "" }
  row.import_ref = ref("expense", [title, category, amount, date.slice(0, 10)])
  return { ok: true, row }
}
