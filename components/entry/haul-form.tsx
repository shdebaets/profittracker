"use client"

import { Camera, Plus, Receipt, RotateCcw, Sparkles, Trash2 } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { createHaul } from "@/app/(app)/actions/items"
import { createPhotoUploads } from "@/app/(app)/actions/photos"
import { friendlyError } from "@/lib/errors"
import { compressImage } from "@/lib/image"
import { SUPABASE_KEY } from "@/lib/supabase/env"
import { FieldLabel, MoneyInput, Segmented, Stepper, TextInput, Toggle } from "@/components/fields"
import { addDays, dateInputToIso, toDateInput } from "@/lib/dates"
import { formatCents, toCents } from "@/lib/money"
import { distributeHaul } from "@/lib/profit"

type Line = { key: number; title: string; qty: number; est: string }

export function HaulForm({ defaultReturnDays, onDone }: { defaultReturnDays: number; onDone: () => void }) {
  const [name, setName] = useState("")
  const [mode, setMode] = useState<"even" | "value">("even")
  const [receipt, setReceipt] = useState<{ path: string; url: string } | null>(null)
  const [uploading, setUploading] = useState(false)
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
    lines.map((l) => ({ title: l.title, quantity: l.qty, estValueCents: mode === "even" ? 0 : toCents(l.est) })),
  )
  const units = lines.reduce((a, l) => a + l.qty, 0)

  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  async function pickReceipt(file: File | undefined) {
    if (!file) return
    setUploading(true)
    try {
      const res = await createPhotoUploads(1)
      if (!res.ok) throw new Error(res.error)
      const blob = await compressImage(file)
      const body = new FormData()
      body.append("cacheControl", "3600")
      body.append("", blob, "receipt.jpg")
      const put = await fetch(res.uploads[0].signedUrl, { method: "PUT", body, headers: { apikey: SUPABASE_KEY, "x-upsert": "false" } })
      if (!put.ok) throw new Error("Couldn't upload the receipt. Check your connection and try again.")
      setReceipt({ path: res.uploads[0].path, url: URL.createObjectURL(blob) })
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setUploading(false)
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!totalCents) return void toast.error("Enter the receipt total")
    startTransition(async () => {
      const res = await createHaul({
        title: name || undefined,
        splitMode: mode,
        receiptPath: receipt?.path ?? null,
        store: store || undefined,
        totalCents,
        purchasedAt: dateInputToIso(date),
        returnable,
        returnDeadline: returnable ? addDays(defaultReturnDays, new Date(dateInputToIso(date))) : null,
        lines: lines.map((l) => ({ title: l.title, quantity: l.qty, estValueCents: toCents(l.est) })),
      })
      if (!res.ok) return void toast.error(res.error)
      toast.success(`Lot logged: ${lines.length} item${lines.length === 1 ? "" : "s"}, ${units} unit${units === 1 ? "" : "s"}`)
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <FieldLabel htmlFor="haul-name">Lot name</FieldLabel>
        <TextInput id="haul-name" placeholder="50 video games, estate sale" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <FieldLabel htmlFor="haul-store">Store</FieldLabel>
          <TextInput id="haul-store" placeholder="Where you bought it" value={store} onChange={(e) => setStore(e.target.value)} />
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

      <label className="flex items-center gap-3 rounded-2xl border bg-card p-3">
        <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted">
          {receipt ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={receipt.url} alt="Receipt" className="size-full object-cover" />
          ) : (
            <Receipt className="size-5 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1 text-sm">
          <span className="block font-semibold">{receipt ? "Receipt added" : "Receipt photo"}</span>
          <span className="block text-xs text-muted-foreground">{uploading ? "Uploading…" : "Optional. Kept with the lot for your records."}</span>
        </span>
        <Camera className="size-5 shrink-0 text-brand" />
        <input type="file" accept="image/*" className="hidden" onChange={(e) => pickReceipt(e.target.files?.[0])} />
      </label>

      <div className="flex flex-col gap-2">
        <div>
          <FieldLabel className="mb-0.5">Split the cost</FieldLabel>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "even", label: "Even" },
              { value: "value", label: "By value" },
            ]}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {mode === "even"
              ? "Every unit gets the same cost. Lot of 50 for $200 = $4 each."
              : "Enter what each item should sell for. Pricier items take a bigger share of the cost."}
          </p>
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
              {mode === "value" && (
                <MoneyInput value={l.est} onChange={(v) => update(l.key, { est: v })} placeholder="est. value" className="h-11 flex-1" />
              )}
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
        type="submit" disabled={pending || uploading}
        className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-brand text-lg font-bold text-ink shadow-lg shadow-brand/25 disabled:opacity-60"
      >
        <Sparkles className="size-5" />
        {pending ? "Saving…" : `Save Lot · ${units} unit${units === 1 ? "" : "s"}`}
      </button>
    </form>
  )
}
