"use client"

import { TrendingDown } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { repriceItems } from "@/app/(app)/actions/edit"
import { MoneyInput, NativeSelect } from "@/components/fields"
import { toCents } from "@/lib/money"

/** Drop the price of several items at once, on FlipLedger and every live listing. */
export function RepriceBar({ itemIds, label }: { itemIds: string[]; label: string }) {
  const [mode, setMode] = useState<"percent" | "amount" | "set">("percent")
  const [pct, setPct] = useState("15")
  const [money, setMoney] = useState("")
  const [pending, start] = useTransition()
  const value = mode === "percent" ? Number(pct) : toCents(money)

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-brand/40 bg-brand-soft p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <TrendingDown className="size-4 text-brand" /> {label}
      </p>
      <div className="flex gap-2">
        <NativeSelect value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="w-36 shrink-0">
          <option value="percent">Drop %</option>
          <option value="amount">Drop $</option>
          <option value="set">Set price</option>
        </NativeSelect>
        {mode === "percent" ? (
          <label className="flex h-12 flex-1 items-center gap-1 rounded-2xl border bg-card px-3">
            <input
              inputMode="numeric" value={pct}
              onChange={(e) => setPct(e.target.value.replace(/\D/g, "").slice(0, 2))}
              className="w-full bg-transparent font-mono font-semibold outline-none"
            />
            <span className="text-muted-foreground">%</span>
          </label>
        ) : (
          <MoneyInput value={money} onChange={setMoney} className="flex-1" />
        )}
      </div>
      <button
        disabled={pending || !(value > 0)}
        onClick={() =>
          start(async () => {
            const res = await repriceItems({ itemIds, mode, value })
            if (!res.ok) return void toast.error(res.error)
            const parts = [`${res.updated} repriced`]
            if (res.synced) parts.push(`${res.synced} live on eBay`)
            if (res.pending) parts.push(`${res.pending} to update on other sites`)
            if (res.failed) parts.push(`${res.failed} failed`)
            if (res.skipped) parts.push(`${res.skipped} skipped (no price yet)`)
            toast.success(parts.join(" · "))
          })
        }
        className="h-12 rounded-2xl bg-brand font-bold text-ink disabled:opacity-50"
      >
        {pending ? "Updating…" : `Reprice ${itemIds.length} item${itemIds.length === 1 ? "" : "s"} everywhere`}
      </button>
      <p className="text-xs text-muted-foreground">
        eBay updates in place, so watchers and search rank stay. Other sites show up as &quot;Update&quot; on each item.
      </p>
    </div>
  )
}
