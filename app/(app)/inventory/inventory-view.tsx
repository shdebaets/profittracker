"use client"

import { Boxes, Cloud, Download, Package, RotateCcw, Search, Share2, ShoppingBag, Sparkles } from "lucide-react"
import { useState } from "react"
import { PageTitle } from "@/components/app-header"
import { DelistAlerts } from "@/components/crosslist/delist-alerts"
import { useEntry, useSyncItems } from "@/components/entry/entry-provider"
import { ItemCard } from "@/components/item-card"
import { dollars, exportCsv } from "@/lib/csv"
import { daysUntil, inRange, toDateInput, type Range } from "@/lib/dates"
import { formatCents } from "@/lib/money"
import { itemSale, presetFor } from "@/lib/profit"
import type { Item } from "@/lib/types"
import { cn } from "@/lib/utils"

type Tab = "all" | "sales" | "stock"
const TIME: { value: Range; label: string }[] = [
  { value: "today", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All" },
]

const itemDate = (i: Item) => (i.status === "sold" ? i.sold_at : i.purchased_at)
const isReturnEligible = (i: Item) =>
  i.status === "inventory" && !!i.return_deadline && daysUntil(i.return_deadline) >= 0
const isUnlisted = (i: Item) => i.status === "inventory" && !i.listings.some((l) => l.status === "active")

export function InventoryView({ items, email, focusSearch = false }: { items: Item[]; email?: string; focusSearch?: boolean }) {
  const { openItem, openHaul, openEntry } = useEntry()
  const [tab, setTab] = useState<Tab>("all")
  const [time, setTime] = useState<Range>("all")
  const [query, setQuery] = useState("")
  const [chip, setChip] = useState<"all" | "returns" | "unlisted">("all")
  useSyncItems(items)

  const sales = items.filter((i) => i.status === "sold")
  const stock = items.filter((i) => i.status === "inventory")
  const stockValue = stock.reduce((a, i) => a + i.cost_cents * i.quantity, 0)
  const stockUnits = stock.reduce((a, i) => a + i.quantity, 0)

  const byTab = tab === "sales" ? sales : tab === "stock" ? stock : items
  const timeCounts = Object.fromEntries(TIME.map((t) => [t.value, byTab.filter((i) => inRange(itemDate(i), t.value)).length]))
  const returnCount = byTab.filter(isReturnEligible).length
  const unlistedCount = byTab.filter(isUnlisted).length

  const q = query.trim().toLowerCase()
  const visible = byTab.filter((i) => {
    if (!inRange(itemDate(i), time)) return false
    if (chip === "returns" && !isReturnEligible(i)) return false
    if (chip === "unlisted" && !isUnlisted(i)) return false
    if (!q) return true
    return (
      (i.title ?? "").toLowerCase().includes(q) ||
      (i.store ?? "").toLowerCase().includes(q) ||
      String(i.seq) === q.replace("#", "") ||
      String(i.quantity) === q ||
      (i.cost_cents / 100).toFixed(2).includes(q)
    )
  })

  function onExport() {
    exportCsv(
      `flipledger-items-${toDateInput(new Date())}.csv`,
      items.map((i) => {
        const s = i.status === "sold" ? itemSale(i) : null
        return {
          number: i.seq,
          title: i.title ?? "",
          status: i.status,
          quantity: i.quantity,
          unit_cost: dollars(i.cost_cents),
          total_cost: dollars(i.cost_cents * i.quantity),
          store: i.store ?? "",
          purchased_at: i.purchased_at,
          sold_at: i.sold_at ?? "",
          platform: i.platform ? presetFor(i.platform).label : "",
          unit_sale_price: dollars(i.sale_price_cents),
          buyer_shipping: s ? dollars(i.buyer_shipping_cents) : "",
          revenue: s ? dollars(s.revenue) : "",
          fees: s ? dollars(s.fees) : "",
          label_cost: s ? dollars(s.shipping) : "",
          net_profit: s ? dollars(s.net) : "",
          return_deadline: i.return_deadline ?? "",
          link: i.link_url ?? "",
          listed_on: i.listings.filter((l) => l.status === "active").map((l) => l.marketplace).join(" "),
        }
      }),
    )
  }

  return (
    <>
      <PageTitle title="Sales & Inventory" subtitle={`${sales.length} sales · ${stock.length} in inventory`}>
        <button
          onClick={onExport} aria-label="Export CSV"
          className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-profit px-3.5 py-3 font-bold text-white"
        >
          <Download className="size-4" /> CSV
        </button>
      </PageTitle>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={openHaul} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-brand font-bold text-ink shadow-sm">
          <Sparkles className="size-4" /> Log Haul
        </button>
        <button onClick={() => openEntry("inventory")} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-ink font-bold text-white shadow-sm">
          <Package className="size-4" /> Add Stock
        </button>
      </div>

      <div className="flex gap-1 rounded-2xl bg-muted p-1">
        {([
          ["all", `All (${items.length})`, Boxes],
          ["sales", `Sales (${sales.length})`, ShoppingBag],
          ["stock", `Stock (${stock.length})`, Package],
        ] as const).map(([v, label, Icon]) => (
          <button
            key={v} onClick={() => setTab(v)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold transition",
              tab === v ? (v === "stock" ? "bg-brand text-ink shadow-sm" : "bg-card shadow-sm") : "text-muted-foreground",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      {email && (
        <p className="flex items-center gap-2 rounded-2xl border border-profit/30 bg-profit-soft px-4 py-3 text-sm">
          <Cloud className="size-4 shrink-0 text-profit" />
          <span className="min-w-0 truncate">
            Synced with <b className="font-mono">{email}</b> across devices
          </span>
          <span className="ml-auto size-2 shrink-0 rounded-full bg-profit" />
        </p>
      )}

      <DelistAlerts items={items} />

      {tab !== "sales" && (
        <div className="rounded-3xl border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-xs font-bold tracking-wider whitespace-nowrap text-muted-foreground uppercase">
              <Package className="size-4 shrink-0 text-brand" /> Unsold inventory investment
            </p>
            <span className="shrink-0 rounded-full border border-brand/40 bg-brand-soft px-3 py-1 font-mono text-xs font-bold text-brand">
              {stockUnits} unit{stockUnits === 1 ? "" : "s"} in stock
            </span>
          </div>
          <div className="mt-3 flex items-end justify-between gap-3 border-t pt-3">
            <div className="min-w-0">
              <p className="font-mono text-4xl font-extrabold tracking-tight text-brand">{formatCents(stockValue)}</p>
              <p className="text-sm text-muted-foreground">Capital tied up in unsold merchandise</p>
            </div>
            <div className="shrink-0 text-right font-mono text-xs leading-relaxed text-muted-foreground">
              Items: <b className="text-foreground">{stock.length}</b>
              <br />
              Units: <b className="text-foreground">{stockUnits}</b>
            </div>
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-bold tracking-wider text-muted-foreground uppercase">Filter by time</p>
        <div className="flex gap-1 rounded-2xl bg-muted p-1">
          {TIME.map((t) => (
            <button
              key={t.value} onClick={() => setTime(t.value)}
              className={cn(
                "flex-1 rounded-xl py-2 text-sm font-semibold transition",
                time === t.value ? "bg-card shadow-sm" : "text-muted-foreground",
              )}
            >
              {t.label} <span className="font-mono text-xs text-muted-foreground">({timeCounts[t.value]})</span>
            </button>
          ))}
        </div>
      </div>

      <label className="flex h-12 items-center gap-3 rounded-2xl border bg-card px-4">
        <Search className="size-5 text-muted-foreground" />
        <input
          value={query} onChange={(e) => setQuery(e.target.value)} autoFocus={focusSearch}
          placeholder="Search name, qty, or cost…"
          className="w-full bg-transparent outline-none placeholder:text-muted-foreground/70"
        />
      </label>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        <button
          onClick={() => setChip("all")}
          className={cn("shrink-0 rounded-full px-4 py-2 text-sm font-semibold", chip === "all" ? "bg-ink text-white" : "border bg-card")}
        >
          All Items ({byTab.length})
        </button>
        <button
          onClick={() => setChip("returns")}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold",
            chip === "returns" ? "bg-blue-600 text-white" : "border border-blue-200 bg-card text-blue-700",
          )}
        >
          <RotateCcw className="size-4" /> Return Eligible ({returnCount})
        </button>
        {tab !== "sales" && (
          <button
            onClick={() => setChip("unlisted")}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold",
              chip === "unlisted" ? "bg-brand text-ink" : "border bg-card",
            )}
          >
            <Share2 className="size-4" /> Not Listed ({unlistedCount})
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {visible.map((i) => (
          <ItemCard key={i.id} item={i} onOpen={() => openItem(i)} />
        ))}
        {!visible.length && (
          <div className="rounded-3xl border border-dashed bg-card/50 p-8 text-center text-muted-foreground">
            {items.length ? "Nothing matches these filters." : "No items yet. Tap + to add your first one."}
          </div>
        )}
      </div>
    </>
  )
}
