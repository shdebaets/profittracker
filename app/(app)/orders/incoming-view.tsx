"use client"

import { Ban, ExternalLink, PackageCheck, PackageOpen, Pencil, Plus, ShoppingBag, Trash2, Truck, Undo2 } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { deleteIncoming, receiveIncoming, setIncomingCancelled } from "@/app/(app)/actions/incoming"
import { BottomSheet } from "@/components/bottom-sheet"
import { formatDate, relativeTime } from "@/lib/dates"
import { filterIncoming, incomingInfo, isOnTheWay, NO_TRACKING_DAYS, type IncomingFilter, type IncomingOrder } from "@/lib/incoming"
import { formatCents } from "@/lib/money"
import { cn } from "@/lib/utils"
import { IncomingForm } from "./incoming-form"

type Editing = { order?: IncomingOrder; focusTracking?: boolean } | null

export function IncomingView({ orders, defaultReturnDays }: { orders: IncomingOrder[]; defaultReturnDays: number }) {
  const onTheWay = orders.filter(isOnTheWay).length
  const [filter, setFilter] = useState<IncomingFilter>("on_the_way")
  const [editing, setEditing] = useState<Editing>(null)
  const shown = filterIncoming(orders, filter)

  return (
    <>
      <button
        onClick={() => setEditing({})}
        className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-brand font-bold text-ink shadow-sm active:scale-[0.99]"
      >
        <Plus className="size-5" /> Add an order
      </button>

      <div className="flex gap-1 rounded-2xl bg-muted p-1">
        {([
          ["on_the_way", `On the way (${onTheWay})`, Truck],
          ["received", "Received", PackageCheck],
          ["cancelled", "Cancelled", Ban],
        ] as const).map(([v, label, Icon]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-1 py-2.5 text-sm font-semibold transition",
              filter === v ? (v === "on_the_way" ? "bg-brand text-ink shadow-sm" : "bg-card shadow-sm") : "text-muted-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" /> <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-3xl border bg-card p-6 text-center text-muted-foreground">
          {filter === "on_the_way" ? (
            <>
              <ShoppingBag className="mx-auto mb-2 size-8 text-brand" />
              <p className="font-semibold text-foreground">Nothing on the way</p>
              <p className="mt-1 text-sm">Add online orders here to see what&apos;s coming, paste tracking numbers, and spot cancelled orders.</p>
            </>
          ) : filter === "received" ? (
            "Orders you mark received show up here."
          ) : (
            "No cancelled orders."
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((o) => (
            <IncomingCard key={o.id} order={o} onEdit={(focusTracking) => setEditing({ order: o, focusTracking })} />
          ))}
        </div>
      )}

      <p className="px-1 text-xs text-muted-foreground">
        Orders here don&apos;t count in your inventory or profit until you tap Received. No tracking number after {NO_TRACKING_DAYS} days? Check the store didn&apos;t cancel it.
      </p>

      <BottomSheet
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        icon={<ShoppingBag className="size-5 text-brand" />}
        iconClass="bg-brand-soft"
        title={editing?.order ? "Edit order" : "Add an order"}
        description="Something you bought online that hasn't arrived yet"
      >
        {editing && (
          <IncomingForm
            key={editing.order?.id ?? "new"}
            order={editing.order}
            focusTracking={editing.focusTracking}
            defaultReturnDays={defaultReturnDays}
            onDone={() => setEditing(null)}
          />
        )}
      </BottomSheet>
    </>
  )
}

const TONE = {
  brand: "bg-brand-soft text-brand",
  profit: "bg-profit-soft text-profit",
  muted: "bg-muted text-muted-foreground",
  warn: "bg-loss/10 text-loss",
} as const

function IncomingCard({ order, onEdit }: { order: IncomingOrder; onEdit: (focusTracking: boolean) => void }) {
  const [pending, startTransition] = useTransition()
  const info = incomingInfo(order)
  const onTheWay = isOnTheWay(order)
  const titles = order.lines.map((l) => (l.quantity > 1 ? `${l.title} ×${l.quantity}` : l.title)).join(", ")

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    startTransition(async () => {
      const res = await action()
      if (!res.ok) toast.error(res.error)
      else toast.success(success)
    })
  }

  function receive() {
    if (!confirm(`Add ${info.units} unit${info.units === 1 ? "" : "s"} to your inventory?`)) return
    run(() => receiveIncoming(order.id), "Added to inventory")
  }

  return (
    <div className={cn("overflow-hidden rounded-3xl border bg-card shadow-sm", order.status === "cancelled" && "opacity-70")}>
      <button onClick={() => onEdit(false)} className="block w-full p-4 text-left">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-bold uppercase", TONE[info.tone === "warn" ? "brand" : info.tone])}>
                {info.label}
              </span>
              {info.noTracking && <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-bold", TONE.warn)}>No tracking yet</span>}
              {info.carrierName && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-bold">{info.carrierName}</span>}
            </div>
            <p className="mt-1 line-clamp-2 leading-snug font-bold">{titles || "Order"}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {order.retailer || "Online order"}
              {order.order_number && ` · #${order.order_number}`}
              {" · "}
              {order.received_at ? `received ${relativeTime(order.received_at)}` : `ordered ${relativeTime(order.ordered_at)}`}
            </p>
            {onTheWay && order.returnable && order.return_deadline && (
              <p className="text-sm text-muted-foreground">Return by {formatDate(order.return_deadline + "T12:00:00")}</p>
            )}
            {order.note && <p className="mt-1 line-clamp-2 text-sm">{order.note}</p>}
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-lg font-bold">{formatCents(order.total_cents)}</p>
            <p className="font-mono text-xs text-muted-foreground">{info.units} unit{info.units === 1 ? "" : "s"}</p>
          </div>
        </div>
      </button>
      <div className="flex border-t text-sm font-semibold">
        {info.url ? (
          <a href={info.url} target="_blank" rel="noopener noreferrer" className="flex flex-1 items-center justify-center gap-1.5 py-3 text-muted-foreground">
            <ExternalLink className="size-4" /> Track
          </a>
        ) : onTheWay ? (
          <button onClick={() => onEdit(true)} className="flex flex-1 items-center justify-center gap-1.5 py-3 text-muted-foreground">
            <Pencil className="size-4" /> Add tracking
          </button>
        ) : null}
        {onTheWay && (
          <>
            <button
              onClick={() => confirm("Mark this order cancelled?") && run(() => setIncomingCancelled(order.id, true), "Marked cancelled")}
              disabled={pending}
              className="flex flex-1 items-center justify-center gap-1.5 border-l py-3 text-muted-foreground disabled:opacity-50"
            >
              <Ban className="size-4" /> Cancelled
            </button>
            <button onClick={receive} disabled={pending} className="flex flex-1 items-center justify-center gap-1.5 border-l py-3 text-profit disabled:opacity-50">
              <PackageOpen className="size-4" /> Received
            </button>
          </>
        )}
        {order.status === "cancelled" && (
          <>
            <button
              onClick={() => run(() => setIncomingCancelled(order.id, false), "Order restored")}
              disabled={pending}
              className={cn("flex flex-1 items-center justify-center gap-1.5 py-3 text-muted-foreground disabled:opacity-50", info.url && "border-l")}
            >
              <Undo2 className="size-4" /> Not cancelled
            </button>
            <button
              onClick={() => confirm("Delete this order for good?") && run(() => deleteIncoming(order.id), "Order deleted")}
              disabled={pending}
              className="flex flex-1 items-center justify-center gap-1.5 border-l py-3 text-loss disabled:opacity-50"
            >
              <Trash2 className="size-4" /> Delete
            </button>
          </>
        )}
      </div>
    </div>
  )
}
