// Bulk reprice: what each item's new price would be. Pure, shared by the RepricePanel preview
// and the repriceItems action, so the seller sees exactly what gets saved.
import { repriced } from "./stale"

export type RepriceMode = "suggested" | "percent" | "amount" | "set"

/** percent: 1–90; amount and set: cents; suggested: no value (each item's sold median). */
export type RepriceChange = { mode: RepriceMode; value?: number }

export type RepriceRow = { id: string; priceCents: number | null }

export type RepricePlan = {
  changes: { id: string; from: number | null; to: number }[]
  /** No price to drop from yet (percent/amount). */
  noPrice: string[]
  /** No sold median on file (suggested). */
  noSuggestion: string[]
  /** Already at that price. */
  unchanged: string[]
}

/** `suggested` maps an item id to its suggested price in cents (the recent sold median). */
export function planReprice(rows: RepriceRow[], c: RepriceChange, suggested: Record<string, number> = {}): RepricePlan {
  const plan: RepricePlan = { changes: [], noPrice: [], noSuggestion: [], unchanged: [] }
  for (const r of rows) {
    let to: number
    if (c.mode === "suggested") {
      const s = suggested[r.id]
      if (!(s > 0)) {
        plan.noSuggestion.push(r.id)
        continue
      }
      to = repriced(0, { mode: "set", value: s })
    } else {
      if (r.priceCents == null && c.mode !== "set") {
        plan.noPrice.push(r.id)
        continue
      }
      to = repriced(r.priceCents ?? 0, { mode: c.mode, value: c.value ?? 0 })
    }
    if (to === r.priceCents) plan.unchanged.push(r.id)
    else plan.changes.push({ id: r.id, from: r.priceCents, to })
  }
  return plan
}

/** Whether the panel's input is usable for this mode. */
export function validChange(c: RepriceChange): boolean {
  if (c.mode === "suggested") return true
  const v = c.value ?? 0
  return c.mode === "percent" ? v >= 1 && v <= 90 : v > 0
}
