"use client"

import { ChevronDown, Layers, Receipt, Sparkles } from "lucide-react"
import { useState } from "react"
import { useEntry, useSyncItems } from "@/components/entry/entry-provider"
import { ItemCard } from "@/components/item-card"
import { formatDate } from "@/lib/dates"
import { lotStats, type Haul } from "@/lib/lots"
import { formatCents, formatPct } from "@/lib/money"
import type { Item } from "@/lib/types"
import { cn } from "@/lib/utils"

export function LotsView({ hauls, items }: { hauls: (Haul & { receipt_url: string | null })[]; items: Item[] }) {
  const { openHaul, openItem } = useEntry()
  const [open, setOpen] = useState<string | null>(null)
  useSyncItems(items)

  return (
    <>
      <button onClick={openHaul} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-brand font-bold text-ink shadow-sm">
        <Sparkles className="size-4" /> Log a Lot
      </button>
      {hauls.length === 0 && (
        <div className="rounded-3xl border border-dashed bg-card/50 p-8 text-center text-sm text-muted-foreground">
          Bought a bundle? Log it as a lot. FlipLedger splits the cost across every item and tracks what the lot returns.
        </div>
      )}
      {hauls.map((h) => {
        const s = lotStats(h, items)
        const lotItems = items.filter((i) => i.haul_id === h.id)
        const isOpen = open === h.id
        return (
          <section key={h.id} className="rounded-3xl border bg-card shadow-sm">
            <button onClick={() => setOpen(isOpen ? null : h.id)} className="flex w-full items-start gap-3 p-4 text-left">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-soft">
                <Layers className="size-5 text-brand" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{h.title || h.store || "Lot"}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatDate(h.purchased_at)}
                  {h.store && h.title ? ` · ${h.store}` : ""} · {s.units} unit{s.units === 1 ? "" : "s"}
                </span>
                <span className="mt-2 block text-sm">
                  This {formatCents(h.total_cents)} lot has returned{" "}
                  <b className={cn("font-mono", s.returned >= h.total_cents ? "text-profit" : "")}>{formatCents(s.returned)}</b> so far
                </span>
              </span>
              <ChevronDown className={cn("mt-3 size-5 shrink-0 text-muted-foreground transition", isOpen && "rotate-180")} />
            </button>
            <div className="grid grid-cols-3 gap-2 border-t px-4 py-3 text-center font-mono text-xs">
              <span>
                <b className="block text-sm">{s.unitsSold}/{s.units}</b>
                <span className="text-muted-foreground">sold</span>
              </span>
              <span>
                <b className={cn("block text-sm", s.profit < 0 ? "text-loss" : "text-profit")}>{formatCents(s.profit)}</b>
                <span className="text-muted-foreground">profit</span>
              </span>
              <span>
                <b className={cn("block text-sm", s.roi < 0 ? "text-loss" : "text-profit")}>{formatPct(s.roi)}</b>
                <span className="text-muted-foreground">ROI</span>
              </span>
            </div>
            {isOpen && (
              <div className="flex flex-col gap-3 border-t p-4">
                {h.receipt_url && (
                  <a href={h.receipt_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm font-semibold text-brand">
                    <Receipt className="size-4" /> View receipt
                  </a>
                )}
                <p className="text-xs text-muted-foreground">
                  Cost split {h.split_mode === "even" ? "evenly" : "by estimated value"}. {formatCents(s.stockCost)} of it is still in stock.
                </p>
                {lotItems.map((i) => (
                  <ItemCard key={i.id} item={i} onOpen={() => openItem(i)} />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </>
  )
}
