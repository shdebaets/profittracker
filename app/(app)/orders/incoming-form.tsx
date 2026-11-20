"use client"

import { Plus, RotateCcw, Trash2 } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { createIncoming, updateIncoming } from "@/app/(app)/actions/incoming"
import { FieldLabel, MoneyInput, Stepper, TextInput, Toggle } from "@/components/fields"
import { addDays, dateInputToIso, toDateInput } from "@/lib/dates"
import { CARRIER_NAMES, detectCarrier, type IncomingOrder } from "@/lib/incoming"
import { centsToInput, toCents } from "@/lib/money"

type Line = { key: number; title: string; qty: number }

/** Add or edit an incoming order. Lines and total are locked once the order is in inventory. */
export function IncomingForm({
  order, defaultReturnDays, focusTracking = false, onDone,
}: { order?: IncomingOrder; defaultReturnDays: number; focusTracking?: boolean; onDone: () => void }) {
  const received = !!order?.received_at
  const [retailer, setRetailer] = useState(order?.retailer ?? "")
  const [orderNumber, setOrderNumber] = useState(order?.order_number ?? "")
  const [date, setDate] = useState(toDateInput(order ? new Date(order.ordered_at) : new Date()))
  const [total, setTotal] = useState(order ? centsToInput(order.total_cents) : "")
  const [tracking, setTracking] = useState(order?.tracking_number ?? "")
  const [returnable, setReturnable] = useState(order?.returnable ?? false)
  const [deadline, setDeadline] = useState(order?.return_deadline ?? "")
  const [note, setNote] = useState(order?.note ?? "")
  const [lines, setLines] = useState<Line[]>(
    order?.lines.length ? order.lines.map((l, i) => ({ key: i + 1, title: l.title, qty: l.quantity })) : [{ key: 1, title: "", qty: 1 }],
  )
  const [pending, startTransition] = useTransition()
  const carrier = tracking.trim() ? detectCarrier(tracking) : null

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  function setReturns(v: boolean) {
    setReturnable(v)
    if (v && !deadline) setDeadline(addDays(defaultReturnDays, new Date(dateInputToIso(date))))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const totalCents = toCents(total)
    if (!received && lines.some((l) => !l.title.trim())) return void toast.error("Give every item a name")
    startTransition(async () => {
      const input = {
        retailer: retailer || undefined,
        orderNumber: orderNumber || undefined,
        orderedAt: dateInputToIso(date),
        totalCents,
        lines: lines.map((l) => ({ title: l.title, quantity: l.qty, estValueCents: 0 })),
        trackingNumber: tracking || undefined,
        returnable,
        returnDeadline: returnable ? deadline || null : null,
        note: note || undefined,
      }
      const res = order ? await updateIncoming(order.id, input) : await createIncoming(input)
      if (!res.ok) return void toast.error(res.error)
      toast.success(order ? "Order saved" : "Order added")
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <FieldLabel htmlFor="in-retailer">Store</FieldLabel>
          <TextInput id="in-retailer" placeholder="Walmart, Target…" value={retailer} onChange={(e) => setRetailer(e.target.value)} maxLength={100} />
        </div>
        <div className="min-w-0">
          <FieldLabel htmlFor="in-number">Order #</FieldLabel>
          <TextInput id="in-number" placeholder="Optional" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} maxLength={100} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <FieldLabel htmlFor="in-date">Ordered</FieldLabel>
          <TextInput id="in-date" type="date" className="px-3 text-[15px]" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="min-w-0">
          <FieldLabel htmlFor="in-total">Total paid</FieldLabel>
          <MoneyInput id="in-total" value={total} onChange={setTotal} />
        </div>
      </div>
      {received && <p className="-mt-2 text-xs text-muted-foreground">Already in your inventory, so the items and total are edited there.</p>}

      <div>
        <FieldLabel htmlFor="in-tracking">Tracking number</FieldLabel>
        <TextInput
          id="in-tracking" autoFocus={focusTracking} placeholder="Paste it when the store emails it"
          value={tracking} onChange={(e) => setTracking(e.target.value)} maxLength={60} autoCapitalize="characters" autoComplete="off"
        />
        {tracking.trim() && (
          <p className="mt-1 text-xs text-muted-foreground">{carrier ? `Looks like ${CARRIER_NAMES[carrier]}.` : "Carrier not recognised; Track will search for it."}</p>
        )}
      </div>

      {!received && (
        <div className="flex flex-col gap-2">
          <FieldLabel className="mb-0">What you ordered</FieldLabel>
          {lines.map((l, idx) => (
            <div key={l.key} className="flex flex-col gap-2 rounded-2xl border bg-card p-3">
              <TextInput
                placeholder={`Item ${idx + 1} name`} value={l.title} className="h-11" maxLength={200}
                onChange={(e) => update(l.key, { title: e.target.value })}
              />
              <div className="flex items-center justify-between gap-2">
                <Stepper value={l.qty} onChange={(n) => update(l.key, { qty: n })} />
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
            </div>
          ))}
          <button
            type="button"
            onClick={() => setLines((ls) => [...ls, { key: Date.now(), title: "", qty: 1 }])}
            className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-dashed text-sm font-semibold text-muted-foreground"
          >
            <Plus className="size-4" /> Add item
          </button>
          <p className="text-xs text-muted-foreground">
            When it arrives, tap Received and these go into your inventory with the total split evenly per unit.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted"><RotateCcw className="size-5 text-muted-foreground" /></span>
          <div className="flex-1">
            <p className="font-semibold">Qualifies for Returns</p>
            <p className="text-sm text-muted-foreground">You&apos;ll get a reminder before the window closes</p>
          </div>
          <Toggle checked={returnable} onChange={setReturns} label="Qualifies for returns" />
        </div>
        {returnable && (
          <div>
            <FieldLabel htmlFor="in-deadline">Return by</FieldLabel>
            <TextInput id="in-deadline" type="date" className="px-3 text-[15px]" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
        )}
      </div>

      <div>
        <FieldLabel htmlFor="in-note">Note</FieldLabel>
        <TextInput id="in-note" placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>

      <button
        type="submit" disabled={pending}
        className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-brand text-lg font-bold text-ink shadow-lg shadow-brand/25 disabled:opacity-60"
      >
        {pending ? "Saving…" : order ? "Save order" : "Add order"}
      </button>
    </form>
  )
}
