import { landed, median } from "./stats"

export type HistoryDay = {
  /** YYYY-MM-DD */
  day: string
  /** Sales that day (judged to be this product). */
  sold: number
  /** Median sold price that day (US sales, best offers out), cents. */
  soldMedian: number | null
  /** Live listings and lowest Buy It Now at the last snapshot that day. */
  live: number | null
  lowest: number | null
}

type Sale = { priceCents: number; shippingCents: number | null; soldOn: string; bestOffer: boolean }
type Snap = { taken_at: string; live_count: number; lowest_cents: number | null }

/** One row per day for the last `days` days, oldest first. Pure. */
export function buildHistory(sales: Sale[], snaps: Snap[], now: Date, days = 90): HistoryDay[] {
  const byDay = new Map<string, Sale[]>()
  for (const s of sales) byDay.set(s.soldOn, [...(byDay.get(s.soldOn) ?? []), s])
  const lastSnap = new Map<string, Snap>()
  for (const s of [...snaps].sort((a, b) => a.taken_at.localeCompare(b.taken_at))) lastSnap.set(s.taken_at.slice(0, 10), s)
  const out: HistoryDay[] = []
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10)
    const list = byDay.get(day) ?? []
    const prices = list.filter((s) => !s.bestOffer).map(landed).filter((p): p is number => p != null)
    const snap = lastSnap.get(day)
    out.push({ day, sold: list.length, soldMedian: median(prices), live: snap?.live_count ?? null, lowest: snap?.lowest_cents ?? null })
  }
  return out
}
