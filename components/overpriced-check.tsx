"use client"

import { Loader2, TriangleAlert } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { findOverpriced } from "@/app/(app)/actions/comps"
import { repriceItems } from "@/app/(app)/actions/edit"
import type { Overpriced } from "@/lib/comps/overpriced"
import { formatCents } from "@/lib/money"

/** "These 8 items are priced 25%+ above recent sold prices", with one-tap reprice everywhere. */
export function OverpricedCheck() {
  const [items, setItems] = useState<Overpriced[] | null>(null)
  const [pending, start] = useTransition()

  const check = () =>
    start(async () => {
      const res = await findOverpriced()
      if (!res.ok) return void toast.error(res.error)
      setItems(res.items)
      if (!res.checked) toast.message("No sold prices on file for your items yet. Comp them on a computer with the extension first.")
    })

  const setPrice = (list: Overpriced[]) =>
    start(async () => {
      let done = 0
      for (const o of list) {
        const res = await repriceItems({ itemIds: [o.itemId], mode: "set", value: o.soldMedianCents })
        if (res.ok) done++
        else toast.error(res.error)
      }
      toast.success(`${done} repriced to the sold median everywhere`)
      setItems((cur) => cur?.filter((x) => !list.includes(x)) ?? null)
    })

  if (!items) {
    return (
      <button onClick={check} disabled={pending} className="flex h-11 items-center justify-center gap-2 rounded-2xl border bg-card text-sm font-semibold disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <TriangleAlert className="size-4 text-brand" />} Check for overpriced items
      </button>
    )
  }
  if (!items.length) return <p className="rounded-2xl bg-profit-soft px-4 py-3 text-sm">Nothing priced 25%+ above recent sold prices.</p>

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-brand/40 bg-brand-soft p-4">
      <p className="text-sm font-semibold">
        {items.length} item{items.length === 1 ? " is" : "s are"} priced 25%+ above recent sold prices.
      </p>
      {items.map((o) => (
        <div key={o.itemId} className="flex items-center gap-2 rounded-2xl bg-card p-3 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{o.title}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {formatCents(o.priceCents)} vs sold {formatCents(o.soldMedianCents)} (+{Math.round(o.overBy * 100)}%)
            </span>
          </span>
          <button disabled={pending} onClick={() => setPrice([o])} className="shrink-0 rounded-xl bg-ink px-3 py-2 font-semibold text-white disabled:opacity-60">
            Set {formatCents(o.soldMedianCents)}
          </button>
        </div>
      ))}
      <button disabled={pending} onClick={() => setPrice(items)} className="h-11 rounded-2xl bg-brand font-bold text-ink disabled:opacity-60">
        {pending ? "Updating…" : "Reprice all to sold median"}
      </button>
    </div>
  )
}
