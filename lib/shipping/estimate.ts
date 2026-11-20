// Rough USPS label cost from weight and box size, using the published commercial prices. Pure.
// Without the buyer's ZIP the zone isn't known, so each service gives a nearby / typical / cross-country price.
import { DIM_DIVISOR, DIM_THRESHOLD_CUIN, FLAT_RATE, GROUND_ADVANTAGE, LENGTH_SURCHARGE, PRIORITY_MAIL } from "./usps-prices"

export const MAX_WEIGHT_OZ = 20 * 16

/** Zones used for the range: nearby (zone 1), typical (zone 5), cross-country (zone 8). Zone 9 (HI/AK) left out. */
const NEARBY = 0, TYPICAL = 4, FAR = 7

export type Box = { lengthIn: number; widthIn: number; heightIn: number }

export const BOX_PRESETS = [
  { id: "poly", label: "Poly mailer", dims: [10, 13, 2] },
  { id: "small", label: "Small box", dims: [8, 6, 4] },
  { id: "shoe", label: "Shoe box", dims: [14, 10, 5] },
  { id: "medium", label: "Medium box", dims: [12, 12, 8] },
  { id: "large", label: "Large box", dims: [16, 12, 10] },
] as const
export type BoxPresetId = (typeof BOX_PRESETS)[number]["id"]

export type ServiceEstimate = {
  service: "Ground Advantage" | "Priority Mail"
  nearby: number
  typical: number
  far: number
  /** Pounds charged when dimensional weight beats the scale weight. */
  dimWeightLb: number | null
}

export type ShippingEstimate =
  | { ok: true; services: ServiceEstimate[]; flatRate: { name: string; cents: number }[] }
  | { ok: false; reason: "no_weight" | "too_heavy" }

const sorted = (b: Box) => [b.lengthIn, b.widthIn, b.heightIn].map((n) => Math.max(0, n || 0)).sort((x, y) => y - x)

/** Dimensional weight in whole pounds, or 0 when the box is 1 cubic foot or smaller. */
export function dimWeightLb(box: Box): number {
  const [l, w, h] = sorted(box)
  const cu = l * w * h
  return cu > DIM_THRESHOLD_CUIN ? Math.ceil(cu / DIM_DIVISOR) : 0
}

function priceFor(rows: typeof GROUND_ADVANTAGE, oz: number): readonly number[] | null {
  return rows.find(([limit]) => oz <= limit + 1e-9)?.[1] ?? null
}

export function estimateShipping(weightOz: number, box: Box): ShippingEstimate {
  if (!(weightOz > 0)) return { ok: false, reason: "no_weight" }
  const dim = dimWeightLb(box)
  const billedOz = Math.max(weightOz, dim * 16)
  if (billedOz > MAX_WEIGHT_OZ) return { ok: false, reason: "too_heavy" }
  const length = sorted(box)[0]

  const services: ServiceEstimate[] = []
  for (const [service, rows, surcharge] of [
    ["Ground Advantage", GROUND_ADVANTAGE, LENGTH_SURCHARGE.ground],
    ["Priority Mail", PRIORITY_MAIL, LENGTH_SURCHARGE.priority],
  ] as const) {
    const p = priceFor(rows, billedOz)
    if (!p) continue
    const extra = length > 30 ? surcharge.over30 : length > 22 ? surcharge.over22 : 0
    services.push({
      service,
      nearby: p[NEARBY] + extra,
      typical: p[TYPICAL] + extra,
      far: p[FAR] + extra,
      dimWeightLb: dim * 16 > weightOz ? dim : null,
    })
  }

  // Flat rate boxes the item fits in (any orientation), up to 70 lb; we only go to 20.
  const [l, w, h] = sorted(box)
  const flatRate = FLAT_RATE.filter((f) => {
    const [fl, fw, fh] = [...f.dims].sort((a, b) => b - a)
    return l <= fl && w <= fw && h <= fh
  }).map((f) => ({ name: f.name, cents: f.cents }))

  return { ok: true, services, flatRate }
}

/** The cheapest typical price across services and fitting flat-rate options, for "Use $X". */
export function cheapestTypical(e: ShippingEstimate): number | null {
  if (!e.ok) return null
  const all = [...e.services.map((s) => s.typical), ...e.flatRate.map((f) => f.cents)]
  return all.length ? Math.min(...all) : null
}
