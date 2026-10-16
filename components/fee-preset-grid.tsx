"use client"

import { Tag } from "lucide-react"
import { FEE_PRESETS } from "@/lib/profit"
import type { Platform } from "@/lib/types"
import { cn } from "@/lib/utils"

export function FeePresetGrid({
  platform, onPlatform, customPct, onCustomPct, effectivePct,
}: {
  platform: Platform
  onPlatform: (p: Platform) => void
  customPct: string
  onCustomPct: (v: string) => void
  effectivePct: number
}) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-bold tracking-wide uppercase">
          <Tag className="size-4 text-muted-foreground" /> Platform & payment fee
        </p>
        <span className="font-mono text-sm font-semibold text-brand">
          {+(effectivePct * 100).toFixed(2)}%{platform === "card" ? " + $0.30" : ""}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {FEE_PRESETS.map((p) => (
          <button
            key={p.id} type="button" onClick={() => onPlatform(p.id)}
            className={cn(
              "rounded-xl border px-3 py-2.5 text-left transition",
              platform === p.id ? "border-brand bg-brand text-ink" : "bg-card",
            )}
          >
            <p className="text-sm font-bold leading-tight">{p.label}</p>
            <p className={cn("truncate text-xs", platform === p.id ? "text-ink/70" : "text-muted-foreground")}>{p.hint}</p>
          </button>
        ))}
      </div>
      {platform === "custom" && (
        <label className="mt-3 flex h-12 items-center gap-2 rounded-xl border bg-muted/60 px-4">
          <input
            inputMode="decimal" placeholder="e.g. 12.9" value={customPct} autoFocus
            onChange={(e) => onCustomPct(e.target.value.replace(/[^0-9.]/g, ""))}
            className="w-full bg-transparent font-mono font-semibold outline-none"
          />
          <span className="font-mono text-muted-foreground">%</span>
        </label>
      )}
    </div>
  )
}
