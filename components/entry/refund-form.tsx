"use client"

import { Undo2 } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { setRefund } from "@/app/(app)/actions/tax"
import { MoneyInput } from "@/components/fields"
import { centsToInput, toCents } from "@/lib/money"
import type { Item } from "@/lib/types"

/** Record money refunded to the buyer after a sale. It lowers profit and goes on Schedule C line 2. */
export function RefundForm({ item, onDone }: { item: Item; onDone: () => void }) {
  const [open, setOpen] = useState(item.refund_cents > 0)
  const [value, setValue] = useState(item.refund_cents ? centsToInput(item.refund_cents) : "")
  const [pending, start] = useTransition()

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 self-start text-sm font-semibold text-muted-foreground">
        <Undo2 className="size-4" /> Refunded the buyer?
      </button>
    )
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-2xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const res = await setRefund({ itemId: item.id, refundCents: toCents(value) })
          if (!res.ok) return void toast.error(res.error)
          toast.success(toCents(value) ? "Refund saved" : "Refund cleared")
          onDone()
        })
      }}
    >
      <label htmlFor="refund" className="font-semibold">Refunded to buyer</label>
      <p className="text-xs text-muted-foreground">Lowers this sale&apos;s profit. Shows as returns and allowances on Schedule C.</p>
      <div className="flex gap-2">
        <MoneyInput id="refund" value={value} onChange={setValue} className="flex-1" />
        <button disabled={pending} className="shrink-0 rounded-2xl bg-ink px-5 font-bold text-white disabled:opacity-60">Save</button>
      </div>
    </form>
  )
}
