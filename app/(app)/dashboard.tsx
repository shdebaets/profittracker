"use client"

import { Award, Box, Plus, Sparkles, TrendingUp } from "lucide-react"
import { useState } from "react"
import { PageTitle } from "@/components/app-header"
import { DelistAlerts } from "@/components/crosslist/delist-alerts"
import { useEntry, useSyncItems } from "@/components/entry/entry-provider"
import { Segmented } from "@/components/fields"
import { StatCard } from "@/components/stat-card"
import { formatDateAt, RANGE_LABELS, type Range } from "@/lib/dates"
import { formatCents, formatPct, formatSignedCents } from "@/lib/money"
import { expenseTotals, subscriptionCost } from "@/lib/overhead"
import { summarize } from "@/lib/profit"
import type { Expense, Item, Subscription } from "@/lib/types"
import { cn } from "@/lib/utils"

const SHORT_RANGE: Record<Range, string> = { all: "All Time", today: "Today", week: "Week", month: "Month" }

export function Dashboard({ items, expenses, subs }: { items: Item[]; expenses: Expense[]; subs: Subscription[] }) {
  const [range, setRange] = useState<Range>("all")
  const { openEntry, openItem } = useEntry()
  useSyncItems(items)
  const s = summarize(items, range)
  const overhead = expenseTotals(expenses, range).total + subscriptionCost(subs, range)
  const afterOverhead = s.net - overhead
  // Revenue splits into cost of goods, fees + label costs, and profit.
  const costsOther = s.revenue - s.cogSold - s.net
  const share = (c: number) => (s.revenue > 0 ? Math.max(0, c) / s.revenue : 0)
  const pctLabel = (c: number) => `${Math.round(share(c) * 100)}%`

  return (
    <>
      <PageTitle title="Performance Overview" subtitle="Resell revenue, profits & inventory">
        <button
          onClick={() => openEntry("sold")}
          className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-profit px-4 py-3 font-bold text-white shadow-md shadow-profit/25"
        >
          <Plus className="size-5" /> New Entry
        </button>
      </PageTitle>

      <DelistAlerts items={items} />

      <Segmented
        value={range}
        onChange={setRange}
        options={(Object.keys(RANGE_LABELS) as Range[]).map((r) => ({ value: r, label: SHORT_RANGE[r] }))}
      />

      <section className="rounded-3xl border border-profit/30 bg-gradient-to-br from-profit-soft to-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-xs font-bold tracking-wider text-muted-foreground uppercase">
            <Sparkles className="size-4 text-profit" /> Realized net profit
          </p>
          <span className="rounded-full border border-profit/30 bg-profit-soft px-3 py-1 font-mono text-xs font-bold text-profit">
            {formatPct(s.margin)} margin
          </span>
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <p className={cn("font-mono text-[2.6rem] leading-none font-extrabold tracking-tighter", s.net < 0 ? "text-loss" : "text-profit")}>
            {formatCents(s.net)}
          </p>
          <p className="pb-1 text-right font-mono text-sm leading-tight text-muted-foreground">
            {s.salesCount} sale{s.salesCount === 1 ? "" : "s"}
            <br />
            (profit)
          </p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 border-t pt-4 font-mono text-xs text-muted-foreground">
          <p>
            COG Sold: <span className="text-foreground">{formatCents(s.cogSold)}</span>
            <br />({pctLabel(s.cogSold)})
          </p>
          <p>
            Profit: <span className="text-foreground">{formatCents(s.net)}</span>
            <br />({pctLabel(s.net)})
          </p>
        </div>
        <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted">
          <div className="bg-brand transition-all" style={{ width: `${share(s.cogSold) * 100}%` }} />
          <div className="bg-muted-foreground/35 transition-all" style={{ width: `${share(costsOther) * 100}%` }} />
          <div className="bg-profit/80 transition-all" style={{ width: `${share(s.net) * 100}%` }} />
        </div>
        {costsOther > 0 && (
          <p className="mt-2 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-muted-foreground/35" />
            Fees & shipping: {formatCents(costsOther)} ({pctLabel(costsOther)})
          </p>
        )}
        <p className="mt-3 flex justify-between border-t pt-3 text-sm">
          <span className="text-muted-foreground">After overhead ({formatCents(overhead)})</span>
          <span className={cn("font-mono font-semibold", afterOverhead < 0 ? "text-loss" : "text-foreground")}>
            {formatSignedCents(afterOverhead)}
          </span>
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          tone="blue" icon={<TrendingUp className="size-4" />} label="Total Revenue"
          value={formatCents(s.revenue)} sub={`From ${s.salesCount} realized sale${s.salesCount === 1 ? "" : "s"}`}
        />
        <StatCard
          tone="brand" icon={<Box className="size-4" />} label="Inventory Value"
          value={formatCents(s.inventoryValue)} sub={`${s.inventoryUnits} unit${s.inventoryUnits === 1 ? "" : "s"} unsold stock`}
        />
        <StatCard label="Avg Profit / Sale" value={formatCents(s.avgProfit)} sub="Per realized sale" />
        <StatCard label="Total Logged Items" value={s.totalItems} sub={range === "all" ? "All time" : RANGE_LABELS[range]} />
      </div>

      {s.best ? (
        <button
          onClick={() => openItem(s.best!.item)}
          className="rounded-3xl border bg-card p-5 text-left shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <p className="flex items-center gap-2 font-bold whitespace-nowrap text-brand">
              <Award className="size-5" /> Best Performing Sale
            </p>
            <p className="font-mono text-xs whitespace-nowrap text-muted-foreground">{formatDateAt(s.best.item.sold_at!)}</p>
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-lg font-bold uppercase">{s.best.item.title || `Item #${s.best.item.seq}`}</p>
              <p className="font-mono text-sm text-muted-foreground">
                COG {formatCents(s.best.sale.cog)} · Sold for {formatCents(s.best.sale.revenue)}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-xl font-bold text-profit">{formatSignedCents(s.best.sale.net)}</p>
              <p className="font-mono text-xs text-muted-foreground">{formatPct(s.best.sale.margin)} margin</p>
            </div>
          </div>
        </button>
      ) : (
        <div className="rounded-3xl border border-dashed bg-card/50 p-8 text-center">
          <p className="font-semibold">No sales {range === "all" ? "yet" : RANGE_LABELS[range].toLowerCase()}</p>
          <p className="mt-1 text-sm text-muted-foreground">Tap + to log your first flip.</p>
        </div>
      )}
    </>
  )
}
