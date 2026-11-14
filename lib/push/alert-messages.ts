// Weekly alert digest push copy ("4 stale, 2 overpriced"). Pure.

export type AlertCounts = { stale: number; overpriced: number; staleDays: number }

export const hasAlerts = (n: AlertCounts) => n.stale > 0 || n.overpriced > 0

/** "4 items sat 60+ days and 2 are overpriced." */
export function alertSummary(n: AlertCounts) {
  const parts: string[] = []
  if (n.stale) parts.push(`${n.stale} ${n.stale === 1 ? "item has" : "items have"} sat ${n.staleDays}+ days`)
  if (n.overpriced) parts.push(`${n.overpriced} ${n.overpriced === 1 ? "is" : "are"} priced 25%+ over recent sales`)
  return parts.join(" and ")
}

/** Where tapping goes: the stale filter when there's stale stock, else inventory (overpriced check). */
export const alertUrl = (n: AlertCounts) => (n.stale ? "/inventory?filter=stale" : "/inventory")

export function alertPush(n: AlertCounts) {
  return {
    title: `${n.stale} stale, ${n.overpriced} overpriced`,
    body: `${alertSummary(n)}. Reprice them in one go?`,
    url: alertUrl(n),
    tag: "alerts",
  }
}
