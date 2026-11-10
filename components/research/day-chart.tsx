"use client"

import { useEffect, useMemo, useRef, useState } from "react"

// One-axis daily chart (lines or bars) with whole-day ticks and a crosshair tooltip that
// works with touch. Two measures with different units are two charts, never two axes.

export type DaySeries = {
  key: string
  label: string
  color: string // CSS color, e.g. "var(--viz-1)"
  kind: "line" | "bar"
  values: (number | null)[]
}

const H = 168
const PAD = { top: 10, right: 10, bottom: 22, left: 44 }
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

function niceStep(range: number) {
  const raw = range / 3
  const p = 10 ** Math.floor(Math.log10(raw || 1))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? p * 10
}

export function DayChart({
  title, days, series, format, zeroBased = true, maxTicks = 6,
}: {
  title: string
  days: string[]
  series: DaySeries[]
  format: (n: number) => string
  zeroBased?: boolean
  maxTicks?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(340)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e!.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { y, ticks, x, band, xTicks } = useMemo(() => {
    const values = series.flatMap((s) => s.values).filter((v): v is number => v != null && Number.isFinite(v))
    let lo = zeroBased ? 0 : Math.min(...values)
    let hi = Math.max(...values, zeroBased ? 1 : lo + 1)
    if (!values.length) [lo, hi] = [0, 1]
    const step = niceStep(hi - lo)
    lo = zeroBased ? 0 : Math.floor(lo / step) * step
    hi = Math.ceil(hi / step) * step
    const plotW = width - PAD.left - PAD.right
    const plotH = H - PAD.top - PAD.bottom
    const band = plotW / Math.max(1, days.length)
    const tickCount = Math.min(maxTicks, days.length)
    const xTicks = tickCount <= 1 ? [0] : Array.from({ length: tickCount }, (_, i) => Math.round((i * (days.length - 1)) / (tickCount - 1)))
    return {
      y: (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH,
      ticks: Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step),
      x: (i: number) => PAD.left + band * i + band / 2,
      band,
      xTicks: [...new Set(xTicks)],
    }
  }, [series, days, width, zeroBased, maxTicks])

  if (!days.length) return null
  const hasData = series.some((s) => s.values.some((v) => v != null))

  function pick(clientX: number) {
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return
    const i = Math.floor((clientX - rect.left - PAD.left) / band)
    setHover(i >= 0 && i < days.length ? i : null)
  }

  return (
    <figure className="rounded-3xl border bg-card p-4 shadow-sm">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-bold">{title}</span>
        {series.length > 1 && (
          <span className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {series.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color, height: 2 }} />
                {s.label}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      <div
        ref={box}
        className="relative mt-2 touch-pan-y select-none"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <svg width={width} height={H} role="img" aria-label={title} className="block">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground" fontSize={10}>
                {format(t)}
              </text>
            </g>
          ))}
          {xTicks.map((i) => (
            <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"} className="fill-muted-foreground" fontSize={10}>
              {shortDay(days[i]!)}
            </text>
          ))}
          {series.map((s) =>
            s.kind === "bar" ? (
              <g key={s.key}>
                {s.values.map((v, i) => {
                  if (v == null || v <= 0) return null
                  const w = Math.max(1, band - 2)
                  const top = y(v)
                  const h = y(0) - top
                  const r = Math.min(4, w / 2, h)
                  return <path key={i} fill={s.color} d={`M${x(i) - w / 2},${y(0)} V${top + r} q0,-${r} ${r},-${r} H${x(i) + w / 2 - r} q${r},0 ${r},${r} V${y(0)} Z`} />
                })}
              </g>
            ) : (
              <path
                key={s.key}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                d={s.values.reduce((d, v, i) => (v == null ? d : `${d}${d && s.values[i - 1] != null ? "L" : "M"}${x(i)},${y(v)}`), "")}
              />
            ),
          )}
          {hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
              {series.map((s) =>
                s.kind === "line" && s.values[hover] != null ? (
                  <circle key={s.key} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
                ) : null,
              )}
            </g>
          )}
        </svg>
        {!hasData && <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">No data yet</p>}
        {hover != null && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-32 rounded-xl border bg-popover px-3 py-2 text-xs shadow-md"
            style={{ left: Math.min(Math.max(0, x(hover) - 64), width - 140) }}
          >
            <p className="font-semibold">{shortDay(days[hover]!)}</p>
            {series.map((s) => (
              <p key={s.key} className="mt-0.5 flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="font-mono font-semibold">{s.values[hover] == null ? "—" : format(s.values[hover]!)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </figure>
  )
}
