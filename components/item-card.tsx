"use client"

import { CheckCircle2, Clock, Package, RotateCcw, ShoppingBag } from "lucide-react"
import { useTransition } from "react"
import { toast } from "sonner"
import { markReturned } from "@/app/(app)/actions/items"
import { daysUntil, formatDateTime, relativeTime } from "@/lib/dates"
import { formatCents, formatPct, formatSignedCents } from "@/lib/money"
import { itemSale } from "@/lib/profit"
import type { Item } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ListingBadges } from "./crosslist/listing-badges"

export function ItemCard({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const [pending, startTransition] = useTransition()
  const sale = item.status === "sold" ? itemSale(item) : null
  const when = item.status === "sold" ? item.sold_at! : item.purchased_at
  const returnDays = item.status === "inventory" && item.return_deadline ? daysUntil(item.return_deadline) : null
  const windowDays = item.return_deadline
    ? Math.max(1, daysUntil(item.return_deadline, new Date(item.purchased_at)))
    : 1

  return (
    <div className="overflow-hidden rounded-3xl border bg-card shadow-sm">
      <button onClick={onOpen} className="block w-full p-4 text-left">
        <div className="flex items-center gap-2 border-b pb-3">
          {item.status === "sold" ? (
            <span className="flex items-center gap-1 rounded-lg border border-profit/30 bg-profit-soft px-2 py-1 text-xs font-bold tracking-wide text-profit uppercase">
              <ShoppingBag className="size-3.5" /> Sold
            </span>
          ) : item.status === "returned" ? (
            <span className="flex items-center gap-1 rounded-lg border bg-muted px-2 py-1 text-xs font-bold tracking-wide text-muted-foreground uppercase">
              <RotateCcw className="size-3.5" /> Returned
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-lg border border-brand/40 bg-brand-soft px-2 py-1 text-xs font-bold tracking-wide text-brand uppercase">
              <Package className="size-3.5" /> Inventory
            </span>
          )}
          <span className="rounded-lg border bg-muted/60 px-2 py-1 font-mono text-xs">
            Qty: {item.quantity} unit{item.quantity === 1 ? "" : "s"}
          </span>
          <span className="ml-auto font-mono text-sm text-muted-foreground">#{item.seq}</span>
        </div>
        <div className="mt-3 flex items-start justify-between gap-3">
          {item.photo_urls[0] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.photo_urls[0]} alt="" loading="lazy" className="size-14 shrink-0 rounded-xl border bg-muted object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-lg leading-snug font-bold">{item.title || `Item #${item.seq}`}</p>
            <p className="mt-0.5 flex items-start gap-1.5 text-sm leading-snug text-muted-foreground">
              <Clock className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {formatDateTime(when)} · {relativeTime(when)}
                {sale && <> · sold {formatCents(sale.revenue)}</>}
              </span>
            </p>
            {item.status === "inventory" && item.listings.length > 0 && (
              <div className="mt-1.5"><ListingBadges listings={item.listings} /></div>
            )}
          </div>
          <div className="shrink-0 text-right">
            {sale ? (
              <>
                <p className={cn("font-mono text-xl font-bold", sale.net < 0 ? "text-loss" : "text-profit")}>
                  {formatSignedCents(sale.net)}
                </p>
                <p className="font-mono text-xs text-muted-foreground">{formatPct(sale.margin)} margin</p>
              </>
            ) : (
              <>
                <p className="font-mono text-xl font-bold">{formatCents(item.cost_cents * item.quantity)}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {item.quantity > 1 ? `${formatCents(item.cost_cents)} × ${item.quantity}` : "Cost basis"}
                </p>
              </>
            )}
          </div>
        </div>
      </button>

      {returnDays !== null && (
        <div className="mx-4 mb-4 rounded-2xl border border-blue-200 bg-blue-50/60 p-3">
          <div className="flex items-center gap-2">
            {item.store && (
              <span className="max-w-28 shrink-0 truncate rounded-lg bg-blue-600 px-2 py-1 text-xs font-bold text-white uppercase">{item.store}</span>
            )}
            <span className={cn("min-w-0 flex-1 text-sm leading-snug font-semibold", returnDays < 0 ? "text-loss" : returnDays <= 7 ? "text-brand" : "text-blue-700")}>
              {returnDays < 0 ? "Return window closed" : returnDays === 0 ? "Last day to return" : `${returnDays} days left to return`}
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-blue-100">
              <div
                className="h-full rounded-full bg-blue-600"
                style={{ width: `${Math.max(3, Math.min(100, (1 - Math.max(0, returnDays) / windowDays) * 100))}%` }}
              />
            </div>
            <button
              disabled={pending}
              onClick={() => {
                if (!confirm("Mark this item as returned? It will leave your inventory value.")) return
                startTransition(async () => {
                  const res = await markReturned(item.id)
                  if (res.ok) toast.success("Marked returned")
                  else toast.error(res.error)
                })
              }}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border bg-card px-3 py-1.5 text-sm font-semibold shadow-sm disabled:opacity-50"
            >
              <CheckCircle2 className="size-4 text-profit" /> Mark Returned
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
