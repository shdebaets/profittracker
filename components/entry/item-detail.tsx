"use client"

import { ExternalLink, Pencil, RotateCcw, Trash2, DollarSign } from "lucide-react"
import { useTransition } from "react"
import { toast } from "sonner"
import { deleteItem, markReturned } from "@/app/(app)/actions/items"
import { daysUntil, formatDate, formatDateTime } from "@/lib/dates"
import { formatCents, formatPct } from "@/lib/money"
import { itemSale, presetFor } from "@/lib/profit"
import type { Item } from "@/lib/types"
import { cn } from "@/lib/utils"

export function ItemDetail({
  item, onSell, onEdit, onDone,
}: {
  item: Item
  onSell: () => void
  onEdit: () => void
  onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const sale = item.status === "sold" ? itemSale(item) : null

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) {
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) return void toast.error(res.error ?? "Failed")
      toast.success(msg)
      onDone()
    })
  }

  const rows: [string, string][] = [
    ["Quantity", `${item.quantity} unit${item.quantity === 1 ? "" : "s"}`],
    ["Cost / unit", formatCents(item.cost_cents)],
    ["Total cost", formatCents(item.cost_cents * item.quantity)],
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
      {sale && (
        <div className="rounded-2xl border border-profit/30 bg-profit-soft p-4">
          <p className="text-xs font-bold tracking-wide text-profit uppercase">Net profit</p>
          <p className={cn("font-mono text-3xl font-bold", sale.net < 0 ? "text-loss" : "text-profit")}>{formatCents(sale.net)}</p>
          <p className="font-mono text-sm text-muted-foreground">{formatPct(sale.margin)} margin</p>
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

      <div className="grid grid-cols-2 gap-2">
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
