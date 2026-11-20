"use client"

import { Package, Sparkles } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { guessPackage } from "@/app/(app)/actions/shipping"
import { FieldLabel, TextInput } from "@/components/fields"
import { formatCents } from "@/lib/money"
import { BOX_PRESETS, cheapestTypical, estimateShipping, type BoxPresetId } from "@/lib/shipping/estimate"
import { USPS_PRICES_EFFECTIVE } from "@/lib/shipping/usps-prices"
import { cn } from "@/lib/utils"

type BoxChoice = BoxPresetId | "custom"

const num = (s: string) => Math.max(0, Number(s.replace(/[^0-9.]/g, "")) || 0)
const effective = new Date(`${USPS_PRICES_EFFECTIVE}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

/**
 * Rough USPS label cost (Pirate Ship-style commercial prices) from weight and box. The zone depends on
 * the buyer's ZIP, so each service shows a range: nearby, typical, cross-country.
 */
export function ShippingEstimate({ title = "", onUse }: { title?: string; onUse?: (cents: number) => void }) {
  const [name, setName] = useState(title)
  const [lb, setLb] = useState("")
  const [oz, setOz] = useState("")
  const [box, setBox] = useState<BoxChoice>("small")
  const [custom, setCustom] = useState(["", "", ""])
  const [guessing, startGuess] = useTransition()

  const dims = box === "custom" ? custom.map(num) : [...BOX_PRESETS.find((b) => b.id === box)!.dims]
  const weightOz = num(lb) * 16 + num(oz)
  const est = estimateShipping(weightOz, { lengthIn: dims[0], widthIn: dims[1], heightIn: dims[2] })
  const best = cheapestTypical(est)

  function guess() {
    startGuess(async () => {
      const res = await guessPackage(name)
      if (!res.ok) return void toast.error(res.error)
      setLb(String(Math.floor(res.guess.weightOz / 16) || ""))
      setOz(String(res.guess.weightOz % 16 || ""))
      setBox(res.guess.box)
      toast.success("Filled in a guess. Check the weight if you can.")
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <FieldLabel htmlFor="ship-name">What are you shipping?</FieldLabel>
        <div className="flex gap-2">
          <TextInput id="ship-name" placeholder="Nike Dunk Low size 10" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          <button
            type="button" onClick={guess} disabled={guessing || name.trim().length < 2}
            className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-brand-soft px-3 text-sm font-bold text-brand disabled:opacity-50"
          >
            <Sparkles className="size-4" /> {guessing ? "…" : "Guess size"}
          </button>
        </div>
      </div>

      <div>
        <FieldLabel>Packed weight</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex h-12 items-center gap-2 rounded-2xl border bg-muted/60 px-4">
            <input inputMode="decimal" value={lb} onChange={(e) => setLb(e.target.value)} placeholder="0" className="w-full min-w-0 bg-transparent font-mono font-semibold outline-none" aria-label="Pounds" />
            <span className="text-sm text-muted-foreground">lb</span>
          </label>
          <label className="flex h-12 items-center gap-2 rounded-2xl border bg-muted/60 px-4">
            <input inputMode="decimal" value={oz} onChange={(e) => setOz(e.target.value)} placeholder="0" className="w-full min-w-0 bg-transparent font-mono font-semibold outline-none" aria-label="Ounces" />
            <span className="text-sm text-muted-foreground">oz</span>
          </label>
        </div>
      </div>

      <div>
        <FieldLabel>Box</FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          {[...BOX_PRESETS.map((b) => ({ id: b.id as BoxChoice, label: b.label, dims: b.dims.join("×") })), { id: "custom" as BoxChoice, label: "Custom", dims: "" }].map((b) => (
            <button
              key={b.id} type="button" onClick={() => setBox(b.id)}
              className={cn("rounded-xl px-3 py-2 text-left text-sm font-semibold", box === b.id ? "bg-ink text-white" : "border bg-card")}
            >
              {b.label}
              {b.dims && <span className={cn("block font-mono text-[11px] font-normal", box === b.id ? "text-white/70" : "text-muted-foreground")}>{b.dims} in</span>}
            </button>
          ))}
        </div>
        {box === "custom" && (
          <div className="mt-2 grid grid-cols-3 gap-2">
            {["Length", "Width", "Height"].map((l, i) => (
              <TextInput
                key={l} inputMode="decimal" placeholder={`${l} in`} aria-label={`${l} in inches`} className="px-3"
                value={custom[i]} onChange={(e) => setCustom((c) => c.map((v, j) => (j === i ? e.target.value : v)))}
              />
            ))}
          </div>
        )}
      </div>

      {!est.ok ? (
        <p className="rounded-2xl border bg-muted/40 p-3 text-sm text-muted-foreground">
          {est.reason === "no_weight"
            ? "Enter the packed weight to see prices."
            : "Over 20 lb (or a big box charged by size). Check Pirate Ship or UPS for this one."}
        </p>
      ) : (
        <div className="divide-y rounded-2xl border bg-card">
          {est.services.map((s) => (
            <div key={s.service} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold">{s.service}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCents(s.nearby)} nearby · {formatCents(s.far)} cross-country
                  {s.dimWeightLb && ` · charged as ${s.dimWeightLb} lb (box size)`}
                </p>
              </div>
              <p className="shrink-0 font-mono text-lg font-bold">{formatCents(s.typical)}</p>
            </div>
          ))}
          {est.flatRate.slice(0, 2).map((f) => (
            <div key={f.name} className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="flex min-w-0 items-center gap-1.5 font-semibold"><Package className="size-4 shrink-0 text-muted-foreground" /> {f.name}</p>
              <p className="shrink-0 font-mono text-lg font-bold">{formatCents(f.cents)}</p>
            </div>
          ))}
        </div>
      )}

      {onUse && best !== null && (
        <button type="button" onClick={() => onUse(best)} className="h-12 rounded-2xl bg-ink font-bold text-white">
          Use {formatCents(best)} as label cost
        </button>
      )}
      <p className="text-xs text-muted-foreground">
        USPS commercial prices (what Pirate Ship charges) from {effective}. The big number is a typical distance; your exact price depends on the buyer&apos;s ZIP.
      </p>
    </div>
  )
}
