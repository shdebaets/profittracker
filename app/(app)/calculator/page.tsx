"use client"

import { Sparkles, TrendingUp, Truck } from "lucide-react"
import { useState } from "react"
import { PageTitle } from "@/components/app-header"
import { useEntry } from "@/components/entry/entry-provider"
import { FeePresetGrid } from "@/components/fee-preset-grid"
import { FieldLabel, MoneyInput, Stepper } from "@/components/fields"
import { formatCents, formatPct, toCents } from "@/lib/money"
import { calcSale, presetFor } from "@/lib/profit"
import type { Platform } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Card with a label and a large borderless "$ 0.00" amount, as in the reference design. */
function AmountCard({
  id, label, labelClass, hint, value, onChange,
}: {
  id: string
  label: string
  labelClass: string
  hint: React.ReactNode
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label htmlFor={id} className="block rounded-3xl border bg-card p-5 shadow-sm">
      <span className={cn("text-sm font-bold tracking-widest uppercase", labelClass)}>{label}</span>
      <span className="mt-3 flex items-center gap-2 font-mono text-4xl font-bold">
        <span className="text-muted-foreground">$</span>
        <input
          id={id}
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground/40"
        />
      </span>
      <span className="mt-3 block text-sm text-muted-foreground">{hint}</span>
    </label>
  )
}

export default function CalculatorPage() {
  const { openEntry } = useEntry()
  const [cost, setCost] = useState("")
  const [price, setPrice] = useState("")
  const [qty, setQty] = useState(1)
  const [buyerShip, setBuyerShip] = useState("")
  const [labelCost, setLabelCost] = useState("")
  const [platform, setPlatform] = useState<Platform>("cash")
  const [customPct, setCustomPct] = useState("")

  const preset = presetFor(platform)
  const feePct = platform === "custom" ? (Number(customPct) || 0) / 100 : preset.pct
  const s = calcSale({
    costCents: toCents(cost),
    salePriceCents: toCents(price),
    quantity: qty,
    buyerShippingCents: toCents(buyerShip),
    labelCostCents: toCents(labelCost),
    feePct,
    feeFixedCents: preset.fixedCents,
  })
  // Break-even sale price per unit (solving net = 0 for price).
  const breakEven =
    feePct < 1
      ? Math.max(0, Math.ceil((s.cog + s.shipping + preset.fixedCents - toCents(buyerShip) * (1 - feePct)) / (1 - feePct) / Math.max(1, qty)))
      : 0

  return (
    <>
      <PageTitle title="Profit Calculator" subtitle="Know your margin before you buy or list" />
      <AmountCard
        id="calc-cost" label="Item Cost (COG)" labelClass="text-amber-900"
        hint="What you paid per unit" value={cost} onChange={setCost}
      />
      <AmountCard
        id="calc-price" label="Sale Price (Revenue)" labelClass="text-blue-950"
        hint={<>Selling price before shipping or fees{toCents(cost) > 0 && <> · break-even <b className="font-mono">{formatCents(breakEven)}</b></>}</>}
        value={price} onChange={setPrice}
      />

      <div className="flex items-center justify-between gap-3 rounded-3xl border bg-card p-5 shadow-sm">
        <div>
          <p className="text-lg font-bold">Quantity Units</p>
          <p className="text-muted-foreground">{qty === 1 ? "Single unit" : `${qty} units`}</p>
        </div>
        <Stepper value={qty} onChange={setQty} />
      </div>

      <div className="rounded-3xl border bg-card p-5 shadow-sm">
        <p className="mb-4 flex items-center gap-2 text-sm font-bold tracking-wider whitespace-nowrap uppercase">
          <Truck className="size-5 text-muted-foreground" /> Shipping Details (Optional)
        </p>
        <FieldLabel className="text-foreground">Buyer Paid Shipping (Added to Revenue)</FieldLabel>
        <MoneyInput value={buyerShip} onChange={setBuyerShip} placeholder="0" />
        <FieldLabel className="mt-4 text-foreground">Your Actual Label / Shipping Cost</FieldLabel>
        <MoneyInput value={labelCost} onChange={setLabelCost} placeholder="0" />
      </div>

      <FeePresetGrid
        platform={platform} onPlatform={setPlatform}
        customPct={customPct} onCustomPct={setCustomPct} effectivePct={feePct}
      />

      <div className="rounded-3xl border border-profit/30 bg-profit-soft p-5">
        <div className="flex items-center gap-3">
          <TrendingUp className="size-7 shrink-0 text-profit" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-profit">Estimated Net Profit</p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {formatCents(s.revenue)} revenue − {formatCents(s.cog)} cost
            </p>
          </div>
          <div className="text-right">
            <p className={cn("font-mono text-2xl font-extrabold tabular-nums", s.net < 0 ? "text-loss" : "text-profit")}>
              {formatCents(s.net)}
            </p>
            <p className="font-mono text-xs text-profit">{formatPct(s.margin)} margin</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2 border-t border-profit/20 pt-3 font-mono text-xs text-muted-foreground">
          <p>Revenue<br /><span className="text-sm font-semibold text-foreground tabular-nums">{formatCents(s.revenue)}</span></p>
          <p>Fees<br /><span className="text-sm font-semibold text-foreground tabular-nums">{formatCents(s.fees)}</span></p>
          <p>Cost<br /><span className="text-sm font-semibold text-foreground tabular-nums">{formatCents(s.cog)}</span></p>
          <p>Shipping<br /><span className="text-sm font-semibold text-foreground tabular-nums">{formatCents(s.shipping)}</span></p>
        </div>
        <button
          disabled={!toCents(price)}
          onClick={() => openEntry("sold", { cost, price, qty, buyerShip, labelCost, platform, customPct })}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-profit font-bold text-white disabled:opacity-40"
        >
          <Sparkles className="size-4" /> Log this sale
        </button>
      </div>
    </>
  )
}
