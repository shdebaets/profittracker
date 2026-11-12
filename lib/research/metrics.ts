// Research math: which listings and sales count, unit volume, medians and the headline
// numbers. Pure and browser-safe; ported from CompAmp's tested sold-research module.
import { median } from "./calc"
import { addDays, dayET, inWindow, todayET, windowET } from "./days"
import { editionRule, mentions, versionWords, type Profile, type Version } from "./profile"
import type { Listing, Sale } from "./types"

const num = (v: unknown) => Number(v ?? 0)

export const countsSale = (s: Pick<Sale, "source" | "verdict">) =>
  s.source !== "collector" || (!!s.verdict && !["pending", "review", "reject"].includes(s.verdict))
/** A real, positive price. Modelled rows without one never reach medians or charts. */
export const hasPrice = (s: { price: number | null }) => s.price != null && num(s.price) > 0
/** Prices that represent the market: no accepted best offers, no presales sold after release. */
export const usablePrice = (s: Pick<Sale, "best_offer" | "presale" | "sold_on" | "price">, release?: string | null) =>
  !s.best_offer && !(s.presale && !!release && s.sold_on >= release) && hasPrice(s)
export const setVersion = (v?: Version) =>
  !!v && /set\s*(?:of\s*)?2|both|pair|2\s*(?:x|pack)|multi.edition/i.test([v.name, ...(v.aliases ?? [])].join(" "))

/** Live = flagged live, not past its end date and with stock left. */
export function isLive(l: Pick<Listing, "live" | "end_date" | "avail_qty">, now = new Date()) {
  return !!l.live && (!l.end_date || Date.parse(l.end_date) > now.getTime()) && (l.avail_qty == null || num(l.avail_qty) > 0)
}
/** The listing's version is known from its title or item specifics (not just "it's the product"). */
export const confirmedVersion = (l: Pick<Listing, "version_key">) => !!l.version_key && l.version_key !== "unknown_version"

export function versionHits(sp: Record<string, string>, title: string, profile: Profile) {
  const text = [title, ...Object.values(sp)].join(" ")
  return profile.versions.filter((v) => mentions(text, versionWords(v)))
}

const UNKNOWN_LANGUAGE = /^(|not shown|n\/?a|unknown|none|not applicable|does not apply|-)$/i

/** Cross-check a verdict against the listing's item specifics (language, quantity, version). */
export function specificsVerdict(sp: Record<string, string>, key: string, profile: Profile) {
  const get = (re: RegExp) => Object.entries(sp).find(([name]) => re.test(name))?.[1]
  const language = (get(/^language$/i) ?? "").trim()
  if (!UNKNOWN_LANGUAGE.test(language) && !/^english$/i.test(language))
    return { verdict: "review", reason: `Item specifics: language is ${language}` }
  const quantity = Number(get(/^(number of (?:items|boxes)|number in pack|unit quantity)$/i) ?? 1)
  if (quantity >= 2 && !setVersion(profile.versions.find((v) => v.key === key)))
    return { verdict: "review", reason: `Item specifics: number of items is ${quantity}` }
  // A field decides only when it names exactly one version (or another edition) and nothing else.
  const decided = new Set<string>()
  for (const [name, value] of Object.entries(sp)) {
    if (/^language$/i.test(name)) continue
    const hits = profile.versions.filter((v) => mentions(String(value), versionWords(v))).map((v) => v.key)
    const others = (profile.other_editions ?? []).filter((o) => mentions(String(value), [o.name, ...o.words])).map((o) => `other:${o.name}`)
    const all = [...hits, ...others]
    if (all.length === 1) decided.add(all[0]!)
  }
  if (decided.size !== 1) return null
  const hit = [...decided][0]!
  if (hit.startsWith("other:")) return { verdict: "review", reason: `Item specifics: mentions ${hit.slice(6)}` }
  const version = profile.versions.find((v) => v.key === hit)!
  if (key === "unknown_version") return { verdict: hit, reason: "Version assigned from item specifics" }
  if (hit !== key) return { verdict: "review", reason: `Item specifics: mentions ${version.name}` }
  return null
}

/** Rule-based verdict before any AI call: exclusions, then the single-edition rule. */
export { editionRule }

export function volumeDays(s: Pick<Sale, "source" | "volume_days" | "sold_on" | "qty">): { day: string; qty: number }[] {
  return s.source === "collector" && Array.isArray(s.volume_days) && s.volume_days.length
    ? s.volume_days
    : [{ day: s.sold_on, qty: s.qty }]
}

/** Extra units of a multi-quantity listing, spread evenly from max(created, release) to the sold day. */
export function spreadUnits(estimated: unknown, created: string | null, soldOn: string, release?: string | null) {
  const units = Math.max(1, Math.min(2147483647, Math.floor(Number(estimated) || 1)))
  const createdDay = created ? dayET(created) : null
  const startDay = createdDay && release && release > createdDay ? release : createdDay
  const end = Date.parse(soldOn + "T00:00:00Z")
  const start = startDay ? Date.parse(startDay + "T00:00:00Z") : end
  if (!Number.isFinite(start) || start > end || end - start > 3650 * 864e5) return { units, days: [{ day: soldOn, qty: units }] }
  const length = Math.floor((end - start) / 864e5) + 1
  const days = new Map<string, number>([[soldOn, 1]])
  const extra = units - 1
  for (let i = 0; i < length && extra > 0; i++) {
    const qty = Math.ceil(((i + 1) * extra) / length) - Math.ceil((i * extra) / length)
    if (!qty) continue
    const day = new Date(start + i * 864e5).toISOString().slice(0, 10)
    days.set(day, (days.get(day) ?? 0) + qty)
  }
  return { units, days: [...days].map(([day, qty]) => ({ day, qty })).sort((a, b) => a.day.localeCompare(b.day)) }
}

/**
 * Sold units from collected sales plus units already sold on still-live multi-quantity
 * listings, counting each eBay listing once (the larger estimate wins).
 */
export function reconciledSales(sales: Sale[], listings: Listing[], now = new Date(), release?: string | null): Sale[] {
  const today = todayET(now)
  const byId = new Map<string, Sale>()
  const other: Sale[] = []
  for (const s of sales.filter(countsSale)) {
    if (s.source !== "collector") {
      other.push(s)
      continue
    }
    const old = byId.get(s.external_id)
    if (!old || s.units > old.units) byId.set(s.external_id, s)
  }
  const modelled = new Set<string>()
  for (const l of listings.filter((l) => isLive(l, now) && l.status === "counted" && l.details_state === "available" && num(l.sold_qty) > 0)) {
    const id = l.legacy_id ?? l.item_id
    const old = byId.get(id)
    modelled.add(l.id)
    if (old && old.units >= num(l.sold_qty)) continue
    const allocation = spreadUnits(l.sold_qty, l.start_date, today, release)
    byId.set(id, {
      ...(old ?? ({} as Sale)),
      id: old?.id ?? -byId.size - 1,
      product_id: l.product_id,
      external_id: id,
      listing_id: l.id,
      source: "collector",
      verdict: l.version_key ?? "unknown_version",
      version_key: l.version_key,
      units: allocation.units,
      qty: allocation.units,
      volume_days: allocation.days,
      sold_on: old?.sold_on ?? today,
      title: l.title,
      price: old?.price ?? null,
      best_offer: old?.best_offer ?? false,
      presale: l.presale,
      listing_created_at: l.start_date,
    })
  }
  const collectorListings = new Set(listings.filter((l) => byId.has(l.legacy_id ?? l.item_id)).map((l) => l.id))
  return [...byId.values(), ...other.filter((s) => !s.listing_id || (!modelled.has(s.listing_id) && !collectorListings.has(s.listing_id)))]
}

const unitsBetween = (sales: Sale[], from: string, to: string) =>
  sales.filter(countsSale).flatMap(volumeDays).filter((d) => d.day >= from && d.day < to).reduce((n, d) => n + d.qty, 0)

export function unitsIn(sales: Sale[], days: number, now = new Date()) {
  const w = windowET(days, now)
  return unitsBetween(sales, w.from, w.to)
}

/** Units sold over the last 7 full days, and the change versus the 7 days before. */
export function weekUnits(sales: Sale[], now = new Date()) {
  const w = windowET(7, now)
  const current = unitsBetween(sales, w.from, w.to)
  const previous = unitsBetween(sales, addDays(w.from, -7), w.from)
  return { units: current, average: current / 7, change: previous ? ((current - previous) / previous) * 100 : null }
}

/** Median of usable sold prices over the N full ET days ending yesterday. */
export function soldMedian(sales: Sale[], days: number, release?: string | null, now = new Date()) {
  const w = windowET(days, now)
  return median(sales.filter(countsSale).filter((s) => usablePrice(s, release) && inWindow(s.sold_on, w)).map((s) => num(s.price)))
}

export function defaultSalePrice(sales: Sale[], bins: number[], release?: string | null, now = new Date()) {
  for (const days of [7, 30]) {
    const value = soldMedian(sales, days, release, now)
    if (value !== null) return { value, source: `${days}-day sold median` }
  }
  return { value: median(bins) ?? 0, source: bins.length ? "Median Buy It Now" : "No usable price yet" }
}

/** Sales far from the version's median go to review (presales may run high). */
export function guardSales(rows: Sale[], profile: Profile) {
  const changes: { id: number; verdict: string; reason: string }[] = []
  for (const key of [...profile.versions.map((v) => v.key), "unknown_version"]) {
    const mine = rows.filter((s) => s.verdict === key && hasPrice(s))
    const clean = mine.filter((s) => !s.best_offer && !s.presale && (!profile.release_date || s.sold_on >= profile.release_date))
    const med = median((clean.length >= 4 ? clean : mine).map((s) => num(s.price)))
    if (!med) continue
    const low = setVersion(profile.versions.find((v) => v.key === key)) ? 0.7 : 0.55
    for (const s of mine.filter((s) => !s.human_decision))
      if (num(s.price) < low * med || (!s.presale && num(s.price) > 1.9 * med))
        changes.push({ id: s.id, verdict: "review", reason: `Price guard: $${num(s.price).toFixed(2)} vs median $${med.toFixed(2)}` })
  }
  return changes
}

const listingTotal = (l: Listing) => num(l.price) + num(l.shipping)
const isBin = (l: Listing) => (l.buying_options ?? []).includes("FIXED_PRICE")

/** The headline numbers shown on the research page. */
export function headlineMetrics(listings: Listing[], rawSales: Sale[], release?: string | null, now = new Date()) {
  const counted = listings.filter((l) => l.status === "counted")
  const live = counted.filter((l) => isLive(l, now))
  const priced = live.filter((l) => isBin(l) && !l.presale && confirmedVersion(l))
  const bins = priced.map(listingTotal).filter((p) => p > 0)
  const sales = reconciledSales(rawSales, counted, now, release)
  const sold7 = weekUnits(sales, now)
  const sold30 = unitsIn(sales, 30, now)
  return {
    live: live.length,
    unconfirmed: live.filter((l) => !confirmedVersion(l)).length,
    sold7: sold7.units,
    sold7Change: sold7.change,
    sold30,
    lowestBin: bins.length ? Math.min(...bins) : null,
    medianBin: median(bins),
    median7: soldMedian(rawSales, 7, release, now),
    median30: soldMedian(rawSales, 30, release, now),
    sellThrough: sold30 + live.length ? (sold30 / (sold30 + live.length)) * 100 : null,
    daysSupply: sold7.units ? live.length / (sold7.units / 7) : null,
    defaultSale: defaultSalePrice(rawSales, bins, release, now),
  }
}

export type ChartDay = { day: string; live: number; newListings: number; sold: number; lowest: number | null; median7: number | null }

/**
 * Daily series for the charts over [from, today]: live supply reconstructed from listing
 * lifetimes (including listings that ended unsold), units sold, lowest BIN and a 7-day
 * rolling median sold price.
 */
export function chartDays(listings: Listing[], rawSales: Sale[], from: string, release?: string | null, now = new Date()): ChartDay[] {
  const today = todayET(now)
  const counted = listings.filter((l) => l.status === "counted")
  const sales = reconciledSales(rawSales, counted, now, release).filter(countsSale)
  type Supply = { start: string; last: string | null; price: number; bin: boolean }
  const supply = new Map<string, Supply>()
  for (const l of counted) {
    if (!l.start_date) continue
    const live = isLive(l, now)
    const ended = l.end_date ?? (live ? null : l.last_seen)
    const lastDay = live ? null : ended ? (dayET(ended) < today ? dayET(ended) : addDays(today, -1)) : addDays(today, -1)
    supply.set(l.legacy_id ?? l.item_id, {
      start: dayET(l.start_date),
      last: lastDay,
      price: listingTotal(l),
      bin: isBin(l) && !l.presale && confirmedVersion(l),
    })
  }
  for (const s of sales)
    if (s.source === "collector" && s.listing_created_at && !supply.has(s.external_id))
      supply.set(s.external_id, {
        start: dayET(s.listing_created_at),
        last: addDays(s.sold_on, -1),
        price: num(s.price) + num(s.shipping),
        bin: /Buy It Now|Best Offer/i.test(s.format ?? "") && !/\d+ bids?/i.test(s.format ?? "") && hasPrice(s) && !s.presale,
      })
  const rows = [...supply.values()].sort((a, b) => a.start.localeCompare(b.start))
  const volume = new Map<string, number>()
  for (const s of sales) for (const d of volumeDays(s)) volume.set(d.day, (volume.get(d.day) ?? 0) + d.qty)
  const pricesByDay = new Map<string, number[]>()
  for (const s of rawSales.filter(countsSale)) if (usablePrice(s, release)) pricesByDay.set(s.sold_on, [...(pricesByDay.get(s.sold_on) ?? []), num(s.price)])
  const out: ChartDay[] = []
  for (let day = from; day <= today; day = addDays(day, 1)) {
    let live = 0
    let lowest: number | null = null
    let created = 0
    for (const r of rows) {
      if (r.start > day) break
      if (r.start === day) created++
      if (r.last && day > r.last) continue
      live++
      if (r.bin && r.price > 0 && (lowest === null || r.price < lowest)) lowest = r.price
    }
    const window: number[] = []
    for (let i = 0; i < 7; i++) window.push(...(pricesByDay.get(addDays(day, -i)) ?? []))
    out.push({ day, live, newListings: created, sold: volume.get(day) ?? 0, lowest, median7: median(window) })
  }
  return out
}

/** At most `max` evenly spaced whole-day ticks, always including both ends. */
export function dayTicks(days: string[], max = 8) {
  if (days.length <= max) return days
  const step = (days.length - 1) / (max - 1)
  return [...new Set(Array.from({ length: max }, (_, i) => days[Math.round(i * step)]!))]
}

/** First day worth charting: the earliest data, or 14 days before release, within a year. */
export function chartStart(listings: Listing[], sales: Sale[], release?: string | null, now = new Date()) {
  const today = todayET(now)
  const dates = [
    ...sales.filter(countsSale).map((s) => s.sold_on),
    ...listings.filter((l) => l.status === "counted" && l.start_date).map((l) => dayET(l.start_date!)),
  ].sort()
  let start = dates[0] ?? today
  if (release && start < addDays(release, -14)) start = addDays(release, -14)
  const yearAgo = addDays(today, -365)
  return start < yearAgo ? yearAgo : start
}
