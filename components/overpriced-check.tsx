"use client"

import { Loader2, TriangleAlert } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { findOverpriced } from "@/app/(app)/actions/comps"
import { RepricePanel } from "@/components/reprice-panel"
import type { Overpriced } from "@/lib/comps/overpriced"
import { formatCents } from "@/lib/money"

/** "These 8 items are priced 25%+ above recent sold prices", repriced through the shared RepricePanel. */
export function OverpricedCheck() {
  const [items, setItems] = useState<Overpriced[] | null>(null)
  const [pending, start] = useTransition()
  // Results the seller unticked, so the panel leaves them alone.
  const [left, setLeft] = useState<Set<string>>(new Set())

  const check = () =>
    start(async () => {
      const res = await findOverpriced()
      if (!res.ok) return void toast.error(res.error)
      setItems(res.items)
      if (!res.checked) toast.message("No sold prices on file for your items yet. FlipLedger looks up your listed items overnight, or comp one now on the Comp tab.")
    })

  if (!items) {
    return (
      <button onClick={check} disabled={pending} className="flex h-11 items-center justify-center gap-2 rounded-2xl border bg-card text-sm font-semibold disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <TriangleAlert className="size-4 text-brand" />} Check for overpriced items
      </button>
    )
  }
  if (!items.length) return <p className="rounded-2xl bg-profit-soft px-4 py-3 text-sm">Nothing priced 25%+ above recent sold prices.</p>

  const chosen = items.filter((o) => !left.has(o.itemId))
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">
        {items.length} item{items.length === 1 ? " is" : "s are"} priced 25%+ above recent sold prices.
      </p>
      {items.map((o) => (
        <label key={o.itemId} className="flex items-center gap-3 rounded-2xl border bg-card p-3 text-sm">
          <input
            type="checkbox" checked={!left.has(o.itemId)} className="size-5 shrink-0 accent-brand"
            onChange={(e) => setLeft((s) => {
              const n = new Set(s)
              if (e.target.checked) n.delete(o.itemId)
              else n.add(o.itemId)
              return n
            })}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{o.title}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {formatCents(o.priceCents)} vs sold {formatCents(o.soldMedianCents)} (+{Math.round(o.overBy * 100)}%)
            </span>
          </span>
        </label>
      ))}
      {chosen.length > 0 && (
        <RepricePanel
          label={`Reprice ${chosen.length === items.length ? "them" : `${chosen.length} of them`} to what they sell for?`}
          items={chosen.map((o) => ({ id: o.itemId, title: o.title, priceCents: o.priceCents }))}
          suggested={Object.fromEntries(chosen.map((o) => [o.itemId, o.soldMedianCents]))}
          defaultMode="suggested"
          onDone={(ids) => setItems((cur) => cur?.filter((x) => !ids.includes(x.itemId)) ?? null)}
        />
      )}
    </div>
  )
}
