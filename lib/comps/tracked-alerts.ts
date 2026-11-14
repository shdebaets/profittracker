// When a tracked product's numbers are worth a push: its sold median fell under the seller's target
// buy price (buying there now loses money), or it moved more than 15% since the last alert. Pure.
import type { CompStats } from "./stats"

export const MOVE_ALERT_PCT = 0.15

/** The sold median the alerts watch: 30 days, else 90 days, else none. */
export const soldMedianOf = (s: Pick<CompStats, "soldMedian30" | "soldMedian90"> | null | undefined): number | null =>
  s?.soldMedian30 ?? s?.soldMedian90 ?? null

export type TrackedAlert = { kind: "below_target" | "up" | "down"; fromCents: number | null; toCents: number; pct: number | null }

/**
 * `baselineCents` is the median when the seller was last alerted (or first checked); moves are
 * measured from it, so a slow slide still alerts once it adds up to 15%. `prevMedianCents` is the
 * last check's median: "below target" fires only when it crosses, not every day it stays under.
 * Returns the alert (or null) and the baseline to save.
 */
export function trackedAlert(x: {
  targetCents: number | null
  baselineCents: number | null
  prevMedianCents: number | null
  medianCents: number | null
}): { alert: TrackedAlert | null; baselineCents: number | null } {
  const { targetCents: target, baselineCents: base, prevMedianCents: prev, medianCents: now } = x
  if (now == null) return { alert: null, baselineCents: base }
  if (target && now < target && (prev == null || prev >= target)) {
    return { alert: { kind: "below_target", fromCents: prev, toCents: now, pct: prev ? (now - prev) / prev : null }, baselineCents: now }
  }
  if (base == null || base <= 0) return { alert: null, baselineCents: now }
  const pct = (now - base) / base
  if (Math.abs(pct) > MOVE_ALERT_PCT) return { alert: { kind: pct > 0 ? "up" : "down", fromCents: base, toCents: now, pct }, baselineCents: now }
  return { alert: null, baselineCents: base }
}
