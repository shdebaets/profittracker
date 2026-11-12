"use client"

import { Check, Clock, ExternalLink, PackageCheck, Truck, Undo2, User } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { markShipped } from "@/app/(app)/actions/items"
import { PageTitle } from "@/components/app-header"
import { useEntry, useSyncItems } from "@/components/entry/entry-provider"
import { formatDate, relativeTime } from "@/lib/dates"
import { marketplace } from "@/lib/marketplaces/registry"
import { formatSignedCents } from "@/lib/money"
import { filterOrders, isToShip, orderInfo, type Order, type OrderFilter } from "@/lib/orders"
import { itemSale } from "@/lib/profit"
import { cn } from "@/lib/utils"

export function OrdersView({ orders }: { orders: Order[] }) {
  const toShipCount = orders.filter(isToShip).length
  const [filter, setFilter] = useState<OrderFilter>(toShipCount ? "to_ship" : "all")
  useSyncItems(orders)
  const shown = filterOrders(orders, filter)

  return (
    <>
      <PageTitle title="Orders" subtitle="Every sale, from every marketplace" />

      <div className="flex gap-1 rounded-2xl bg-muted p-1">
        {([
          ["to_ship", `To ship (${toShipCount})`, Truck],
          ["shipped", "Shipped", PackageCheck],
          ["all", `All (${orders.length})`, Clock],
        ] as const).map(([v, label, Icon]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold transition",
              filter === v ? (v === "to_ship" ? "bg-brand text-ink shadow-sm" : "bg-card shadow-sm") : "text-muted-foreground",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-3xl border bg-card p-6 text-center text-muted-foreground">
          {filter === "to_ship" ? "Nothing to ship. Nice." : "No sales yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </div>
      )}

      <p className="px-1 text-xs text-muted-foreground">
        eBay orders turn shipped on their own once you ship them on eBay. Sales you log without a marketplace count as handed over.
      </p>
    </>
  )
}

function OrderCard({ order }: { order: Order }) {
  const { openItem } = useEntry()
  const [pending, startTransition] = useTransition()
  const info = orderInfo(order)
  const sale = itemSale(order)
  const toShip = isToShip(order)
  const m = info.soldOn ? marketplace(info.soldOn) : null

  function setShipped(shipped: boolean) {
    startTransition(async () => {
      const res = await markShipped(order.id, shipped)
      if (!res.ok) toast.error(res.error)
      else if (shipped) toast.success("Marked shipped", { action: { label: "Undo", onClick: () => setShipped(false) } })
    })
  }

  return (
    <div className="overflow-hidden rounded-3xl border bg-card shadow-sm">
      <button onClick={() => openItem(order)} className="block w-full p-4 text-left">
        <div className="flex items-start gap-3">
          {order.photo_urls[0] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={order.photo_urls[0]} alt="" loading="lazy" className="size-14 shrink-0 rounded-xl border bg-muted object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {m && <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-bold", m.badge)}>{m.short}</span>}
              {toShip ? (
                <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-bold uppercase", info.late ? "bg-loss text-white" : "bg-brand-soft text-brand")}>
                  {info.late ? "Late" : "To ship"}
                </span>
              ) : (
                <span className="rounded-md bg-profit-soft px-1.5 py-0.5 text-[11px] font-bold text-profit uppercase">Shipped</span>
              )}
            </div>
            <p className="mt-1 line-clamp-2 leading-snug font-bold">{order.title || `Item #${order.seq}`}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Sold {relativeTime(order.sold_at!)}
              {info.buyer && (
                <>
                  {" · "}
                  <User className="inline size-3.5 -translate-y-px" /> {info.buyer}
                </>
              )}
            </p>
            {toShip && info.shipBy && (
              <p className={cn("text-sm font-semibold", info.late ? "text-loss" : "text-foreground")}>Ship by {formatDate(info.shipBy)}</p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className={cn("font-mono text-lg font-bold", sale.net < 0 ? "text-loss" : "text-profit")}>{formatSignedCents(sale.net)}</p>
            <p className="font-mono text-xs text-muted-foreground">{order.cost_unknown ? "before cost" : "profit"}</p>
          </div>
        </div>
      </button>
      <div className="flex border-t">
        {info.url && (
          <a
            href={info.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-semibold text-muted-foreground"
          >
            <ExternalLink className="size-4" /> Open order
          </a>
        )}
        <button
          onClick={() => setShipped(toShip)}
          disabled={pending}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-semibold disabled:opacity-50",
            info.url && "border-l",
            toShip ? "text-profit" : "text-muted-foreground",
          )}
        >
          {toShip ? <><Check className="size-4" /> Mark shipped</> : <><Undo2 className="size-4" /> Not shipped</>}
        </button>
      </div>
    </div>
  )
}
