// Push copy for tracked products (Scan to Comp). Pure.
import type { TrackedAlert } from "@/lib/comps/tracked-alerts"
import { formatCents } from "@/lib/money"

/** `q`: what /comp searches when the push is tapped (the tracked barcode or search). */
export function trackedPush(name: string, a: TrackedAlert, targetCents: number | null, q = name) {
  const n = name.length > 60 ? name.slice(0, 57) + "…" : name
  const pct = a.pct == null ? "" : ` (${a.pct > 0 ? "+" : ""}${Math.round(a.pct * 100)}%)`
  const url = `/comp?q=${encodeURIComponent(q.slice(0, 120))}`
  const tag = `tracked-${n}`
  if (a.kind === "below_target")
    return {
      title: "Under your buy price",
      body: `${n} now sells for ~${formatCents(a.toCents)}, below your ${formatCents(targetCents ?? 0)} target. Skip it at that price.`,
      url,
      tag,
    }
  return {
    title: a.kind === "up" ? "Price going up" : "Price dropping",
    body: `${n} sold median ${a.fromCents != null ? `${formatCents(a.fromCents)} → ` : ""}${formatCents(a.toCents)}${pct}.`,
    url,
    tag,
  }
}
