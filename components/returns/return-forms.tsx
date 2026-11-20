"use client"

import { PackagePlus, RotateCcw } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { buyerReturned, returnToStore, setStoreRefundReceived, undoBuyerReturn, undoStoreReturn } from "@/app/(app)/actions/returns"
import { FieldLabel, MoneyInput, QtyPicker, Toggle } from "@/components/fields"
import { formatCents, centsToInput, toCents } from "@/lib/money"
import { storeRefundCents } from "@/lib/profit"
import type { Item } from "@/lib/types"

/** Take unsold stock back to the store: how many, what the store refunded, whether it's arrived, what it cost. */
export function StoreReturnForm({ item, onDone }: { item: Item; onDone: () => void }) {
  const [qty, setQty] = useState(item.quantity)
  const fullRefund = item.cost_cents * qty
  const [refund, setRefund] = useState<string | null>(null) // null = follow the full refund for the units picked
  const [received, setReceived] = useState(false)
  const [cost, setCost] = useState("")
  const [pending, start] = useTransition()
  const refundCents = refund === null ? fullRefund : toCents(refund)
  const loss = Math.max(0, fullRefund - refundCents) + toCents(cost)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const res = await returnToStore({
        id: item.id,
        quantity: qty,
        refundCents: refund === null ? null : refundCents,
        refundReceived: received,
        returnCostCents: toCents(cost),
      })
      if (!res.ok) return void toast.error(res.error)
      toast.success(qty === item.quantity ? "Returned to the store" : `${qty} returned to the store`)
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {item.quantity > 1 && <QtyPicker value={qty} onChange={setQty} max={item.quantity} label="Units returned" />}
      <div>
        <FieldLabel htmlFor="ret-refund">Refund from the store</FieldLabel>
        <MoneyInput id="ret-refund" value={refund ?? centsToInput(fullRefund)} onChange={setRefund} />
        <p className="mt-1 text-xs text-muted-foreground">You paid {formatCents(fullRefund)}. Lower it if they kept a restocking fee.</p>
      </div>
      <label className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-3 text-sm">
        <span>
          <span className="block font-semibold">Refund already received</span>
          <span className="text-muted-foreground">Leave off to track it until it arrives</span>
        </span>
        <Toggle checked={received} onChange={setReceived} label="Refund already received" />
      </label>
      <div>
        <FieldLabel htmlFor="ret-cost">Return cost (optional)</FieldLabel>
        <MoneyInput id="ret-cost" value={cost} onChange={setCost} placeholder="postage, gas" />
      </div>
      {loss > 0 && <p className="text-sm font-semibold text-loss">You lose {formatCents(loss)} on this return.</p>}
      <button
        type="submit" disabled={pending}
        className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-ink font-bold text-white disabled:opacity-60"
      >
        <RotateCcw className="size-4" /> {pending ? "Saving…" : "Mark returned"}
      </button>
      <p className="text-xs text-muted-foreground">It leaves your inventory value and comes down from your listings.</p>
    </form>
  )
}

/** On a returned item: is the store's refund still pending? */
export function StoreRefundStatus({ item, onDone, compact = false }: { item: Item; onDone?: () => void; compact?: boolean }) {
  const [pending, start] = useTransition()
  const amount = storeRefundCents(item)
  const received = !!item.store_refund_received_at

  function set(v: boolean) {
    start(async () => {
      const res = await setStoreRefundReceived(item.id, v)
      if (!res.ok) return void toast.error(res.error)
      toast.success(v ? "Refund received" : "Marked as still pending")
      onDone?.()
    })
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-muted/40 p-3 text-sm">
      <span className={received ? "min-w-0 flex-1 font-semibold text-profit" : "min-w-0 flex-1 font-semibold text-brand"}>
        {received ? `Refunded ${formatCents(amount)}` : `Refund pending ${formatCents(amount)}`}
        {(item.return_cost_cents ?? 0) > 0 && !compact && (
          <span className="block text-xs font-normal text-muted-foreground">Return cost {formatCents(item.return_cost_cents ?? 0)}</span>
        )}
      </span>
      <button
        type="button" disabled={pending} onClick={() => set(!received)}
        className="shrink-0 rounded-xl border bg-card px-3 py-1.5 font-semibold shadow-sm disabled:opacity-50"
      >
        {received ? "Not received" : "Refund received"}
      </button>
    </div>
  )
}

export function UndoStoreReturn({ item, onDone }: { item: Item; onDone: () => void }) {
  const [pending, start] = useTransition()
  return (
    <button
      type="button" disabled={pending}
      onClick={() => {
        if (!confirm("Put this back in your inventory? Its listings stay ended.")) return
        start(async () => {
          const res = await undoStoreReturn(item.id)
          if (!res.ok) return void toast.error(res.error)
          toast.success("Back in inventory")
          onDone()
        })
      }}
      className="self-start text-sm font-semibold text-muted-foreground"
    >
      Not returned after all? Put it back in inventory
    </button>
  )
}

/** A buyer sent a sold item back: refund, the return label, fees the marketplace gave back, restock. */
export function BuyerReturnForm({ item, onDone }: { item: Item; onDone: () => void }) {
  const paid = (item.sale_price_cents ?? 0) * item.quantity + (item.buyer_shipping_cents ?? 0)
  const [open, setOpen] = useState(false)
  const [refund, setRefund] = useState(centsToInput(paid))
  const [label, setLabel] = useState("")
  const [credit, setCredit] = useState("")
  const [restock, setRestock] = useState(true)
  const [pending, start] = useTransition()

  if (item.buyer_returned_at) {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border bg-card p-4 text-sm">
        <p className="flex items-center gap-1.5 font-bold"><RotateCcw className="size-4" /> Returned by the buyer</p>
        <p className="text-muted-foreground">
          Refunded {formatCents(item.refund_cents)}
          {(item.return_label_cents ?? 0) > 0 && `, return label ${formatCents(item.return_label_cents ?? 0)}`}
          {(item.fee_credit_cents ?? 0) > 0 && `, ${formatCents(item.fee_credit_cents ?? 0)} fees back`}
          {item.restocked ? ". The unit went back into your inventory." : "."}
        </p>
        <button
          type="button" disabled={pending}
          onClick={() => {
            if (!confirm("Undo this buyer return?")) return
            start(async () => {
              const res = await undoBuyerReturn(item.id)
              if (!res.ok) return void toast.error(res.error)
              toast.success("Buyer return undone")
              onDone()
            })
          }}
          className="self-start font-semibold text-muted-foreground"
        >
          Undo
        </button>
      </div>
    )
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 self-start text-sm font-semibold text-muted-foreground">
        <PackagePlus className="size-4" /> Buyer sent it back?
      </button>
    )
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const res = await buyerReturned({
            id: item.id, refundCents: toCents(refund), returnLabelCents: toCents(label), feeCreditCents: toCents(credit), restock,
          })
          if (!res.ok) return void toast.error(res.error)
          toast.success(restock ? "Return saved. It's back in your inventory." : "Return saved")
          onDone()
        })
      }}
    >
      <p className="font-semibold">Buyer returned it</p>
      <div>
        <FieldLabel htmlFor="br-refund">Refunded to the buyer</FieldLabel>
        <MoneyInput id="br-refund" value={refund} onChange={setRefund} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <FieldLabel htmlFor="br-label">Return label</FieldLabel>
          <MoneyInput id="br-label" value={label} onChange={setLabel} placeholder="0" />
        </div>
        <div className="min-w-0">
          <FieldLabel htmlFor="br-credit">Fees you got back</FieldLabel>
          <MoneyInput id="br-credit" value={credit} onChange={setCredit} placeholder="0" />
        </div>
      </div>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          <span className="block font-semibold">Put it back in inventory</span>
          <span className="text-muted-foreground">Turn off if it came back damaged or not at all</span>
        </span>
        <Toggle checked={restock} onChange={setRestock} label="Put it back in inventory" />
      </label>
      <button type="submit" disabled={pending} className="h-12 rounded-2xl bg-ink font-bold text-white disabled:opacity-60">
        {pending ? "Saving…" : "Save return"}
      </button>
      <p className="text-xs text-muted-foreground">The sale stays on your books (it&apos;s still on your 1099-K) with the refund as returns and allowances.</p>
    </form>
  )
}
