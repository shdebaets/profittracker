"use client"

import { Award, Car, ShoppingBag, Store, TrendingDown, TrendingUp } from "lucide-react"
import { useSyncExternalStore } from "react"
import { formatCents, formatSignedCents } from "@/lib/money"
import { lastTwoWeeks, weekNumbers } from "@/lib/recap"
import type { Expense, Item } from "@/lib/types"
import { cn } from "@/lib/utils"

const subscribe = () => () => {}

export function RecapView({ items, expenses }: { items: Item[]; expenses: Expense[] }) {
  // Weeks are counted from the viewer's clock, so render in the browser.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false)
  if (!mounted) return null
  const { week, prev } = lastTwoWeeks(new Date())
  const n = weekNumbers(items, expenses, week)
  const p = weekNumbers(items, expenses, prev)
  const diff = n.profit - p.profit
  const Trend = diff >= 0 ? TrendingUp : TrendingDown

  return (
    <>
      <section className="rounded-3xl border border-profit/30 bg-gradient-to-br from-profit-soft to-card p-5 shadow-sm">
        <p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Profit this week</p>
        <p className={cn("mt-1 font-mono text-[2.4rem] leading-none font-extrabold", n.profit < 0 ? "text-loss" : "text-profit")}>
          {formatCents(n.profit)}
        </p>
        <p className={cn("mt-2 flex items-center gap-1.5 text-sm font-semibold", diff < 0 ? "text-loss" : "text-profit")}>
          <Trend className="size-4" /> {formatSignedCents(diff)} vs last week ({formatCents(p.profit)})
        </p>
      </section>
      <div className="grid grid-cols-2 gap-3">
        <Tile icon={ShoppingBag} label="Items sold" value={String(n.itemsSold)} sub={`${p.itemsSold} last week`} />
        <Tile icon={Car} label="Miles logged" value={`${n.miles} mi`} sub={`${formatCents(n.mileageWriteOff)} write-off`} />
        <Tile icon={Award} label="Top item" value={n.topItem ? formatCents(n.topItem.profit) : "None yet"} sub={n.topItem?.title ?? "No sales this week"} />
        <Tile icon={Store} label="Best platform" value={n.bestPlatform?.label ?? "None yet"} sub={n.bestPlatform ? `${formatCents(n.bestPlatform.profit)} profit` : ""} />
      </div>
    </>
  )
}

function Tile({ icon: Icon, label, value, sub }: { icon: typeof Car; label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 rounded-3xl border bg-card p-4 shadow-sm">
      <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
        <Icon className="size-4" /> {label}
      </p>
      <p className="mt-1.5 truncate font-mono text-xl font-bold">{value}</p>
      <p className="mt-1 truncate text-sm text-muted-foreground">{sub}</p>
    </div>
  )
}
