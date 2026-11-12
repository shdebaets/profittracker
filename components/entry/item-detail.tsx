"use client"

import { CircleDollarSign, ExternalLink, Pencil, RotateCcw, Share2, Trash2, DollarSign } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { deleteItem, markReturned, setItemCost } from "@/app/(app)/actions/items"
import { MoneyInput } from "@/components/fields"
import { daysUntil, formatDate, formatDateTime } from "@/lib/dates"
import { formatCents, formatPct, toCents } from "@/lib/money"
import { itemSale, presetFor } from "@/lib/profit"
import type { Item } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ListingBadges } from "@/components/crosslist/listing-badges"
import { GENERIC_ERROR } from "@/lib/errors"

export function ItemDetail({
  item, onSell, onEdit, onDone, onCrosslist,
}: {
  item: Item
  onSell: () => void
  onEdit: () => void
  onDone: () => void
  onCrosslist: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [cost, setCost] = useState("")
  const sale = item.status === "sold" ? itemSale(item) : null

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) {
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) return void toast.error(res.error ?? GENERIC_ERROR)
      toast.success(msg)
      onDone()
    })
  }

  const rows: [string, string][] = [
    ["Quantity", `${item.quantity} unit${item.quantity === 1 ? "" : "s"}`],
    ["Cost / unit", item.cost_unknown ? "Not entered" : formatCents(item.cost_cents)],
    ["Total cost", item.cost_unknown ? "Not entered" : formatCents(item.cost_cents * item.quantity)],
    ["Purchased", formatDate(item.purchased_at)],
  ]
  if (item.store) rows.push(["Store", item.store])
  if (item.return_deadline && item.status === "inventory") {
    const d = daysUntil(item.return_deadline)
    rows.push(["Return by", `${formatDate(item.return_deadline + "T12:00:00")} (${d >= 0 ? `${d} days left` : "expired"})`])
  }
  if (sale) {
    rows.push(
      ["Sold", formatDateTime(item.sold_at!)],
      ["Sale price / unit", formatCents(item.sale_price_cents ?? 0)],
      ["Platform", presetFor(item.platform).label],
      ["Revenue", formatCents(sale.revenue)],
      ["Fees", formatCents(sale.fees)],
      ["Label / shipping", formatCents(sale.shipping)],
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {item.photo_urls.length > 0 && (
        <div className="-mx-5 flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 [scrollbar-width:none]">
          {item.photo_urls.map((url, i) => (
            <a
              key={item.photo_paths[i]} href={url} target="_blank" rel="noopener noreferrer"
              className={cn(
                "aspect-square shrink-0 snap-center overflow-hidden rounded-2xl border bg-muted",
                item.photo_urls.length === 1 ? "w-full" : "w-[85%]",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Photo ${i + 1}`} className="size-full object-cover" loading={i ? "lazy" : "eager"} />
            </a>
          ))}
        </div>
      )}
      {item.cost_unknown && (
        <form
          className="flex flex-col gap-2 rounded-2xl border border-brand/40 bg-brand-soft p-4"
          onSubmit={(e) => {
            e.preventDefault()
            run(() => setItemCost(item.id, toCents(cost)), "Cost saved")
          }}
        >
          <p className="flex items-center gap-1.5 font-bold text-brand"><CircleDollarSign className="size-4" /> Add cost</p>
          <p className="text-sm text-muted-foreground">
            {item.status === "sold"
              ? "This sale came in from the marketplace, so FlipLedger doesn't know what you paid. Enter it to get the real profit."
              : "Imported from a marketplace. Enter what you paid so profit is right."}
          </p>
          <div className="flex gap-2">
            <MoneyInput id="add-cost" value={cost} onChange={setCost} className="flex-1" autoFocus />
            <button type="submit" disabled={pending || !cost.trim()} className="shrink-0 rounded-2xl bg-brand px-5 font-bold text-ink disabled:opacity-60">
              Save
            </button>
          </div>
          {item.quantity > 1 && <p className="text-xs text-muted-foreground">Per unit, for {item.quantity} units.</p>}
        </form>
      )}
      {sale && (
        <div className="rounded-2xl border border-profit/30 bg-profit-soft p-4">
          <p className="text-xs font-bold tracking-wide text-profit uppercase">{item.cost_unknown ? "Profit before cost" : "Net profit"}</p>
          <p className={cn("font-mono text-3xl font-bold", sale.net < 0 ? "text-loss" : "text-profit")}>{formatCents(sale.net)}</p>
          <p className="font-mono text-sm text-muted-foreground">
            {item.cost_unknown ? "Not your real profit until you add the cost" : `${formatPct(sale.margin)} margin`}
          </p>
        </div>
      )}
      <dl className="divide-y rounded-2xl border bg-card">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-4 py-3 text-sm">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {item.link_url && (
        <a href={item.link_url} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 truncate text-sm font-semibold text-profit">
          <ExternalLink className="size-4 shrink-0" /> <span className="truncate">{item.link_url}</span>
        </a>
      )}

      {item.listings.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Listed on</span>
          <ListingBadges listings={item.listings} showEnded />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {item.status === "inventory" && (
          <button onClick={onCrosslist} className="col-span-2 flex h-12 items-center justify-center gap-2 rounded-2xl bg-brand font-bold text-ink">
            <Share2 className="size-4" /> {item.listings.some((l) => l.status === "active") ? "Manage listings" : "Cross-list"}
          </button>
        )}
        {item.status === "inventory" && (
          <button onClick={onSell} className="col-span-2 flex h-14 items-center justify-center gap-2 rounded-2xl bg-profit text-lg font-bold text-white">
            <DollarSign className="size-5" /> Mark Sold
          </button>
        )}
        <button onClick={onEdit} className="flex h-12 items-center justify-center gap-2 rounded-2xl border bg-card font-semibold">
          <Pencil className="size-4" /> Edit
        </button>
        {item.status === "inventory" && item.returnable ? (
          <button
            disabled={pending}
            onClick={() => run(() => markReturned(item.id), "Marked returned")}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl border bg-card font-semibold"
          >
            <RotateCcw className="size-4" /> Returned
          </button>
        ) : (
          <button
            disabled={pending}
            onClick={() => {
              if (confirm("Delete this entry? This can't be undone.")) run(() => deleteItem(item.id), "Deleted")
            }}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl border bg-card font-semibold text-destructive"
          >
            <Trash2 className="size-4" /> Delete
          </button>
        )}
      </div>
      {item.status === "inventory" && item.returnable && (
        <button
          disabled={pending}
          onClick={() => {
            if (confirm("Delete this entry? This can't be undone.")) run(() => deleteItem(item.id), "Deleted")
          }}
          className="text-sm font-semibold text-destructive"
        >
          Delete entry
        </button>
      )}
    </div>
  )
}
