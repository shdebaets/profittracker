// Scan to Comp's profit box: what's left after a platform's selling fee, the shipping label and
// what you paid. Platforms and fees come from the cross-lister registry's fee presets. Pure.
import { MARKETPLACES, type MarketplaceId } from "@/lib/marketplaces/registry"
import { calcSale, presetFor } from "@/lib/profit"
import { DEFAULT_LABEL_CENTS } from "./stats"

export type ProfitPlatform = { id: MarketplaceId; label: string; feePct: number; feeFixedCents: number }

/** Every marketplace in the registry with the fee its preset charges, eBay first. */
export const PROFIT_PLATFORMS: ProfitPlatform[] = MARKETPLACES.map((m) => {
  const p = presetFor(m.feePreset)
  return { id: m.id, label: m.short, feePct: p.pct, feeFixedCents: p.fixedCents }
})

export const profitPlatform = (id: string | null | undefined): ProfitPlatform =>
  PROFIT_PLATFORMS.find((p) => p.id === id) ?? PROFIT_PLATFORMS[0]

/** "Buy at $8, sells for ~$32 on Mercari, profit ~$19" after the fee and the label. */
export function platformProfit(costCents: number, sellCents: number, platform: MarketplaceId = "ebay", labelCents = DEFAULT_LABEL_CENTS) {
  const p = profitPlatform(platform)
  const s = calcSale({
    costCents,
    salePriceCents: sellCents,
    quantity: 1,
    feePct: p.feePct,
    feeFixedCents: p.feeFixedCents,
    labelCostCents: Math.max(0, labelCents),
  })
  return { profit: s.net, fees: s.fees, label: s.shipping, roi: costCents > 0 ? s.net / costCents : null }
}

/** "13.25%", "2.9% + $0.30", "no fee". */
export function feeText(p: ProfitPlatform): string {
  if (!p.feePct && !p.feeFixedCents) return "no fee"
  const pct = `${Math.round(p.feePct * 10000) / 100}%`
  return p.feeFixedCents ? `${pct} + $${(p.feeFixedCents / 100).toFixed(2)}` : pct
}
