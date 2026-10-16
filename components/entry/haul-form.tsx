"use client"

import { Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { createHaul } from "@/app/(app)/actions/items"
import { FieldLabel, MoneyInput, Stepper, TextInput, Toggle } from "@/components/fields"
import { addDays, dateInputToIso, toDateInput } from "@/lib/dates"
import { formatCents, toCents } from "@/lib/money"
import { distributeHaul } from "@/lib/profit"

type Line = { key: number; title: string; qty: number; est: string }

export function HaulForm({ defaultReturnDays, onDone }: { defaultReturnDays: number; onDone: () => void }) {
  const [store, setStore] = useState("")
  const [total, setTotal] = useState("")
  const [date, setDate] = useState(toDateInput(new Date()))
  const [returnable, setReturnable] = useState(false)
  const [lines, setLines] = useState<Line[]>([
    { key: 1, title: "", qty: 1, est: "" },
    { key: 2, title: "", qty: 1, est: "" },
  ])
  const [pending, startTransition] = useTransition()

  const totalCents = toCents(total)
  const split = distributeHaul(
    totalCents,
    lines.map((l) => ({ title: l.title, quantity: l.qty, estValueCents: toCents(l.est) })),
  )
  const units = lines.reduce((a, l) => a + l.qty, 0)

  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!totalCents) return void toast.error("Enter the receipt total")
    startTransition(async () => {
      const res = await createHaul({
        store: store || undefined,
        totalCents,
        purchasedAt: dateInputToIso(date),
        returnable,
        returnDeadline: returnable ? addDays(defaultReturnDays, new Date(dateInputToIso(date))) : null,
        lines: lines.map((l) => ({ title: l.title, quantity: l.qty, estValueCents: toCents(l.est) })),
      })
      if (!res.ok) return void toast.error(res.error)
      toast.success(`Haul logged: ${lines.length} items, ${units} units`)
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <FieldLabel htmlFor="haul-store">Store</FieldLabel>
          <TextInput id="haul-store" placeholder="Store name" value={store} onChange={(e) => setStore(e.target.value)} />
        </div>
        <div className="min-w-0">
          <FieldLabel htmlFor="haul-date">Date</FieldLabel>
          <TextInput id="haul-date" type="date" className="px-3 text-[15px]" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div>
        <FieldLabel htmlFor="haul-total">Receipt Total (Incl. Tax)</FieldLabel>
        <MoneyInput id="haul-total" big value={total} onChange={setTotal} />
      </div>

      <div className="flex flex-col gap-2">
        <div>
          <FieldLabel className="mb-0.5">Items in This Haul</FieldLabel>
          <p className="text-xs text-muted-foreground">Est. resale value is optional. Higher-value items get a bigger share of the cost.</p>
        </div>
        {lines.map((l, idx) => (
          <div key={l.key} className="rounded-2xl border bg-card p-3">
            <div className="flex gap-2">
              <TextInput
                placeholder={`Item ${idx + 1} name`} value={l.title} className="h-11"
                onChange={(e) => update(l.key, { title: e.target.value })}
              />
              {lines.length > 1 && (
                <button
                  type="button" aria-label="Remove item"
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground active:bg-muted"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Stepper value={l.qty} onChange={(n) => update(l.key, { qty: n })} />
              <MoneyInput value={l.est} onChange={(v) => update(l.key, { est: v })} placeholder="est. value" className="h-11 flex-1" />
            </div>
            {totalCents > 0 && split[idx] && (
              <p className="mt-2 text-right font-mono text-xs text-muted-foreground">
                cost {formatCents(split[idx].unitCostCents)}/unit · {formatCents(split[idx].lineTotalCents)} total
              </p>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setLines((ls) => [...ls, { key: Date.now(), title: "", qty: 1, est: "" }])}
          className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-dashed text-sm font-semibold text-muted-foreground"
        >
          <Plus className="size-4" /> Add item
        </button>
      </div>

      <div className="flex items-center gap-3 rounded-2xl border bg-card p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted"><RotateCcw className="size-5 text-muted-foreground" /></span>
        <div className="flex-1">
          <p className="font-semibold">Qualifies for Returns</p>
          <p className="text-sm text-muted-foreground">{defaultReturnDays}-day window from purchase date</p>
        </div>
        <Toggle checked={returnable} onChange={setReturnable} label="Qualifies for returns" />
      </div>

      <button
        type="submit" disabled={pending}
        className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-brand text-lg font-bold text-ink shadow-lg shadow-brand/25 disabled:opacity-60"
      >
        <Sparkles className="size-5" />
        {pending ? "Saving…" : `Save Haul · ${units} unit${units === 1 ? "" : "s"}`}
      </button>
    </form>
  )
}
