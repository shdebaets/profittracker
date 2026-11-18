"use client"

import { ChevronDown } from "lucide-react"
import { useState } from "react"
import type { HistoryDay } from "@/lib/comps/history"
import { median } from "@/lib/comps/stats"
import { formatCents } from "@/lib/money"
import { cn } from "@/lib/utils"

const RANGES = { "7D": 7, "30D": 30, "90D": 90 } as const
type Range = keyof typeof RANGES

/**
 * SellerAmp-style "More detail" for a comp: price history (sold median per day and lowest live
 * price), sales per day and live listings over time, with 7/30/90-day ranges. Sold history comes
 * from the sales on file; live history from the snapshots taken on each lookup (comp_snapshots),
 * so it fills in as a product gets looked up.
 */
export function CompDetails({ history }: { history: HistoryDay[] }) {
  const [open, setOpen] = useState(false)
  const [range, setRange] = useState<Range>("30D")
  const days = history.slice(-RANGES[range])
  const hasSold = days.some((d) => d.sold > 0)
  const hasLive = days.some((d) => d.live != null)

  const sold = days.reduce((n, d) => n + d.sold, 0)
  const half = Math.floor(days.length / 2)
  const priceOf = (ds: HistoryDay[]) => median(ds.flatMap((d) => (d.soldMedian == null ? [] : [d.soldMedian])))
  const nowPrice = priceOf(days.slice(half))
  const thenPrice = priceOf(days.slice(0, half))
  const lows = days.filter((d) => d.lowest != null)
  const liveRows = days.filter((d) => d.live != null)

  return (
    <section className="rounded-2xl border">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold">
        More detail: price history, sales, listings
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-t px-4 pt-3 pb-4">
          <div className="flex gap-1 self-end rounded-xl bg-muted p-1 text-xs font-semibold">
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <button key={r} onClick={() => setRange(r)} className={cn("rounded-lg px-3 py-1", r === range ? "bg-card shadow-sm" : "text-muted-foreground")}>
                {r}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2 text-center font-mono text-xs">
            <Mini label={`sold ${range}`} value={String(sold)} />
            <Mini label="per day" value={(sold / days.length).toFixed(1)} />
            <Mini label="price trend" value={trend(thenPrice, nowPrice)} tone={nowPrice != null && thenPrice != null ? (nowPrice >= thenPrice ? "up" : "down") : undefined} />
            <Mini label="lowest live" value={lows.length ? trend(lows[0]!.lowest, lows.at(-1)!.lowest) : "n/a"} />
            <Mini label="live listings" value={liveRows.length ? trend(liveRows[0]!.live, liveRows.at(-1)!.live, false) : "n/a"} />
            <Mini label="sold median" value={priceOf(days) == null ? "n/a" : formatCents(priceOf(days)!)} />
          </div>

          <Chart
            title="Price"
            days={days}
            lines={[
              { key: "soldMedian", label: "Sold median", className: "text-blue-600" },
              { key: "lowest", label: "Lowest live", className: "text-red-500", dashed: true },
            ]}
            money
            empty={!hasSold && !hasLive}
          />
          <Bars title="Sales per day" days={days} empty={!hasSold} />
          <Chart
            title="Live listings"
            days={days}
            lines={[{ key: "live", label: "Live listings", className: "text-brand" }]}
            empty={!hasLive}
            note="Fills in as this product gets looked up (one reading every 2 hours at most)."
          />
          <p className="text-xs text-muted-foreground">
            Sold prices are US item prices without shipping, best offers left out. These charts count sold listings, not units: a listing that sold 5 counts once here, while the counts above add up every unit.
          </p>
        </div>
      )}
    </section>
  )
}

function trend(from: number | null | undefined, to: number | null | undefined, money = true) {
  if (from == null || to == null) return "n/a"
  const pct = from ? Math.round(((to - from) / from) * 100) : 0
  const v = money ? formatCents(to) : String(to)
  return `${v} ${pct > 0 ? "▲" : pct < 0 ? "▼" : ""}${pct ? Math.abs(pct) + "%" : ""}`.trim()
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-2xl bg-muted/60 px-2 py-2">
      <p className={cn("font-bold", tone === "up" && "text-profit", tone === "down" && "text-loss")}>{value}</p>
      <p className="text-muted-foreground">{label}</p>
    </div>
  )
}

const W = 320
const H = 120
const PAD = { l: 44, r: 6, t: 8, b: 18 }

type LineKey = "soldMedian" | "lowest" | "live"

function Chart({
  title,
  days,
  lines,
  money,
  empty,
  note,
}: {
  title: string
  days: HistoryDay[]
  lines: { key: LineKey; label: string; className: string; dashed?: boolean }[]
  money?: boolean
  empty: boolean
  note?: string
}) {
  const vals = lines.flatMap((l) => days.flatMap((d) => (d[l.key] == null ? [] : [d[l.key] as number])))
  const lo = vals.length ? Math.min(...vals) : 0
  const hi = vals.length ? Math.max(...vals) : 1
  const pad = (hi - lo) * 0.1 || hi * 0.1 || 1
  const min = Math.max(0, lo - pad)
  const max = hi + pad
  const x = (i: number) => PAD.l + (i / Math.max(days.length - 1, 1)) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b)
  const fmt = (v: number) => (money ? formatCents(Math.round(v)).replace(/\.\d\d$/, "") : String(Math.round(v)))
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="flex flex-wrap items-center gap-3 text-xs font-semibold">
        {title}
        {lines.map((l) => (
          <span key={l.key} className={cn("flex items-center gap-1 font-normal", l.className)}>
            <span className={cn("inline-block w-4 border-t-2 border-current", l.dashed && "border-dashed")} />
            <span className="text-muted-foreground">{l.label}</span>
          </span>
        ))}
      </figcaption>
      {empty ? (
        <p className="rounded-xl bg-muted/60 px-3 py-6 text-center text-xs text-muted-foreground">{note ?? "No data for this range yet."}</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
          {[0, 0.5, 1].map((t) => {
            const v = min + (max - min) * t
            return (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={0.5} />
                <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[8px]">
                  {fmt(v)}
                </text>
              </g>
            )
          })}
          <Ticks days={days} x={x} />
          {lines.map((l) => {
            // Connect the days that have a value; gaps are skipped, not dropped to zero.
            const pts = days.flatMap((d, i) => (d[l.key] == null ? [] : [`${x(i).toFixed(1)},${y(d[l.key] as number).toFixed(1)}`]))
            return (
              <g key={l.key} className={l.className}>
                <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray={l.dashed ? "4 3" : undefined} />
                {pts.length === 1 && <circle cx={pts[0]!.split(",")[0]} cy={pts[0]!.split(",")[1]} r={2} fill="currentColor" />}
              </g>
            )
          })}
        </svg>
      )}
      {note && !empty && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </figure>
  )
}

function Bars({ title, days, empty }: { title: string; days: HistoryDay[]; empty: boolean }) {
  const max = Math.max(1, ...days.map((d) => d.sold))
  const slot = (W - PAD.l - PAD.r) / days.length
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b)
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-xs font-semibold">{title}</figcaption>
      {empty ? (
        <p className="rounded-xl bg-muted/60 px-3 py-6 text-center text-xs text-muted-foreground">No sales on file for this range yet.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(max * t)} y2={y(max * t)} className="stroke-border" strokeWidth={0.5} />
              <text x={PAD.l - 4} y={y(max * t) + 3} textAnchor="end" className="fill-muted-foreground text-[8px]">
                {Math.round(max * t)}
              </text>
            </g>
          ))}
          <Ticks days={days} x={(i) => PAD.l + slot * (i + 0.5)} />
          {days.map((d, i) =>
            d.sold ? (
              <rect key={d.day} x={PAD.l + slot * i + slot * 0.15} width={slot * 0.7} y={y(d.sold)} height={H - PAD.b - y(d.sold)} className="fill-profit">
                <title>{`${d.day}: ${d.sold} sold`}</title>
              </rect>
            ) : null,
          )}
        </svg>
      )}
    </figure>
  )
}

function Ticks({ days, x }: { days: HistoryDay[]; x: (i: number) => number }) {
  const every = Math.max(1, Math.ceil(days.length / 5))
  return (
    <>
      {days.map((d, i) =>
        i % every === 0 || i === days.length - 1 ? (
          <text key={d.day} x={x(i)} y={H - 4} textAnchor="middle" className="fill-muted-foreground text-[8px]">
            {d.day.slice(5).replace("-", "/")}
          </text>
        ) : null,
      )}
    </>
  )
}
