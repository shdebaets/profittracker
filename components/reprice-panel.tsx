"use client"

import { Loader2, TrendingDown } from "lucide-react"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { repriceItems, suggestPrices } from "@/app/(app)/actions/edit"
import { MoneyInput } from "@/components/fields"
import { formatCents, toCents } from "@/lib/money"
import { planReprice, validChange, type RepriceMode } from "@/lib/reprice"
import { cn } from "@/lib/utils"

export type RepriceItem = { id: string; title: string; priceCents: number | null }

const MODES: { value: RepriceMode; label: string }[] = [
  { value: "suggested", label: "Suggested" },
  { value: "percent", label: "Drop %" },
  { value: "amount", label: "Drop $" },
  { value: "set", label: "Set price" },
]

/**
 * One reprice tool for a set of items (bulk selection, the stale filter, overpriced results):
 * suggested (each item's recent sold median), drop by %, drop by $, or one price for all.
 * Saves on FlipLedger and pushes the price to every live listing.
 */
export function RepricePanel({
  items, label, suggested: given, defaultMode = "percent", onDone, className,
}: {
  items: RepriceItem[]
  label: string
  /** Sold medians already known (overpriced results); otherwise fetched when Suggested is picked. */
  suggested?: Record<string, number>
  defaultMode?: RepriceMode
  onDone?: (repricedIds: string[]) => void
  className?: string
}) {
  const [mode, setMode] = useState<RepriceMode>(defaultMode)
  const [pct, setPct] = useState("15")
  const [money, setMoney] = useState("")
  const [fetched, setFetched] = useState<{ key: string; prices: Record<string, number> } | null>(null)
  const [loading, startLoad] = useTransition()
  const [pending, start] = useTransition()

  const ids = items.map((i) => i.id)
  const key = ids.join()
  const suggested = given ?? (fetched?.key === key ? fetched.prices : null)
  const value = mode === "percent" ? Number(pct) : mode === "suggested" ? undefined : toCents(money)
  const change = { mode, value }
  const plan = planReprice(items.map((i) => ({ id: i.id, priceCents: i.priceCents })), change, suggested ?? {})
  const ready = validChange(change) && (mode !== "suggested" || !!suggested) && plan.changes.length > 0

  // Suggested prices come from the sold comps on file; look them up once per set of items.
  useEffect(() => {
    if (mode !== "suggested" || given || fetched?.key === key || !ids.length) return
    startLoad(async () => {
      const res = await suggestPrices(ids)
      if (!res.ok) return void toast.error(res.error)
      setFetched({ key, prices: res.prices })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, key, given])

  const titles = new Map(items.map((i) => [i.id, i.title]))
  const skipped = plan.noPrice.length + plan.noSuggestion.length

  return (
    <div className={cn("flex flex-col gap-3 rounded-3xl border border-brand/40 bg-brand-soft p-4", className)}>
      <p className="flex items-center gap-2 text-sm font-semibold">
        <TrendingDown className="size-4 shrink-0 text-brand" /> {label}
      </p>
      <div className="grid grid-cols-4 gap-1 rounded-2xl bg-card/70 p-1">
        {MODES.map((m) => (
          <button
            key={m.value} type="button" onClick={() => setMode(m.value)}
            className={cn("rounded-xl px-1 py-2 text-xs font-semibold", mode === m.value ? "bg-ink text-white" : "text-muted-foreground")}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode === "percent" ? (
        <label className="flex h-12 items-center gap-1 rounded-2xl border bg-card px-3">
          <input
            inputMode="numeric" value={pct} aria-label="Percent to drop"
            onChange={(e) => setPct(e.target.value.replace(/\D/g, "").slice(0, 2))}
            className="w-full bg-transparent font-mono font-semibold outline-none"
          />
          <span className="text-muted-foreground">%</span>
        </label>
      ) : mode === "suggested" ? (
        <p className="text-xs text-muted-foreground">
          {loading ? (
            <span className="flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> Checking recent sold prices…</span>
          ) : (
            "Each item goes to its median eBay sold price from the last 90 days."
          )}
        </p>
      ) : (
        <MoneyInput value={money} onChange={setMoney} />
      )}

      {plan.changes.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-2xl bg-card p-3 text-sm">
          {plan.changes.slice(0, 4).map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{titles.get(c.id)}</span>
              <span className="shrink-0 font-mono text-xs">
                <span className="text-muted-foreground line-through">{c.from == null ? "—" : formatCents(c.from)}</span>{" "}
                <b>{formatCents(c.to)}</b>
              </span>
            </li>
          ))}
          {plan.changes.length > 4 && <li className="text-xs text-muted-foreground">+{plan.changes.length - 4} more</li>}
        </ul>
      )}
      {skipped > 0 && !(mode === "suggested" && loading) && (
        <p className="text-xs text-muted-foreground">
          {skipped} skipped: {mode === "suggested" ? "no sold prices on file yet (comp them first)" : "no price yet"}.
        </p>
      )}

      <button
        disabled={pending || !ready}
        onClick={() =>
          start(async () => {
            const res = await repriceItems({ itemIds: plan.changes.map((c) => c.id), mode, value })
            if (!res.ok) return void toast.error(res.error)
            const parts = [`${res.updated} repriced`]
            if (res.synced) parts.push(`${res.synced} live on eBay`)
            if (res.pending) parts.push(`${res.pending} to update on other sites`)
            if (res.failed) parts.push(`${res.failed} failed`)
            if (res.skipped) parts.push(`${res.skipped} skipped`)
            toast.success(parts.join(" · "))
            onDone?.(plan.changes.map((c) => c.id))
          })
        }
        className="h-12 rounded-2xl bg-brand font-bold text-ink disabled:opacity-50"
      >
        {pending ? "Updating…" : `Reprice ${plan.changes.length} item${plan.changes.length === 1 ? "" : "s"} everywhere`}
      </button>
      <p className="text-xs text-muted-foreground">
        eBay updates in place, so watchers and search rank stay. Other sites show up under &quot;Needs update&quot;.
      </p>
    </div>
  )
}
