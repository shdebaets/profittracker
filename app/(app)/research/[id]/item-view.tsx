"use client"

import { ArrowLeft, ExternalLink, Loader2, PackagePlus, RefreshCw } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { addResearchToInventory, refreshResearch, setResearchPrices, unwatchResearch } from "@/app/(app)/actions/research"
import { MoneyInput } from "@/components/fields"
import { DayChart } from "@/components/research/day-chart"
import { SoldHistory } from "@/components/research/sold-history"
import { StatCard } from "@/components/stat-card"
import { DEFAULT_RESEARCH_FEES, maxCost, profitAt, TARGET_ROI, verdict } from "@/lib/research/calc"
import type { ResearchItem } from "@/lib/research/data"
import { addDays, stampET, todayET } from "@/lib/research/days"
import { ebaySearchUrl } from "@/lib/research/profile"
import { cn } from "@/lib/utils"
import { VerdictBadge } from "../research-view"

const usd = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toFixed(2)}`)
const whole = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString())
const RANGES = [
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "All", days: 3650 },
] as const

function stepLabel(step: string, p: ResearchItem["track"]) {
  const pr = p?.progress ?? {}
  if (step === "search") return `Searching eBay · ${pr.search?.done ?? 0}/${pr.search?.total ?? "?"} keywords`
  if (step === "judge") return `Matching listings · ${pr.judged ?? 0}/${pr.toJudge ?? "?"}`
  if (step === "details") return `Checking listing details · ${pr.details?.done ?? 0}/${pr.details?.total ?? "?"}`
  return "Working…"
}

export function ItemView({ item }: { item: ResearchItem }) {
  const router = useRouter()
  const { product, headline: h, days, offers, watch, track, sold } = item
  const running = track?.status === "running" || sold?.status === "running"
  // While a run is working, re-read the page's numbers every few seconds.
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => router.refresh(), 5000)
    return () => clearInterval(t)
  }, [running, router])

  const [cost, setCost] = useState(watch?.cost_cents != null ? (watch.cost_cents / 100).toFixed(2) : "")
  const [sale, setSale] = useState(watch?.sale_price_cents != null ? (watch.sale_price_cents / 100).toFixed(2) : "")
  const salePrice = sale ? Number(sale) : h.defaultSale.value
  const costNum = cost ? Number(cost) : 0
  const calc = profitAt(salePrice, 0, costNum, DEFAULT_RESEARCH_FEES)
  const v = costNum > 0 ? verdict(calc.roi) : null
  const max = maxCost(salePrice, 0, DEFAULT_RESEARCH_FEES)
  useEffect(() => {
    const t = setTimeout(() => {
      const c = cost ? Math.round(Number(cost) * 100) : null
      const s = sale ? Math.round(Number(sale) * 100) : null
      if (c === watch?.cost_cents && s === watch?.sale_price_cents) return
      void setResearchPrices(product.id, Number.isFinite(c) ? c : null, Number.isFinite(s) ? s : null)
    }, 800)
    return () => clearTimeout(t)
  }, [cost, sale, product.id, watch?.cost_cents, watch?.sale_price_cents])

  const [range, setRange] = useState<(typeof RANGES)[number]["days"]>(90)
  const shown = useMemo(() => {
    const from = addDays(todayET(), -range)
    return days.filter((d) => d.day >= from)
  }, [days, range])

  const [pending, startTransition] = useTransition()
  const [qty, setQty] = useState(1)

  return (
    <>
      <div className="flex items-center gap-2">
        <Link href="/research" className="grid size-10 place-items-center rounded-2xl border bg-card" aria-label="Back to research">
          <ArrowLeft className="size-5" />
        </Link>
        <button
          onClick={() =>
            startTransition(async () => {
              const r = await refreshResearch(product.id)
              if (!r.ok) toast.error(r.error)
              else router.refresh()
            })
          }
          disabled={pending || running}
          className="ml-auto flex h-10 items-center gap-2 rounded-2xl border bg-card px-3 text-sm font-semibold disabled:opacity-60"
        >
          <RefreshCw className={cn("size-4", running && "animate-spin")} /> {running ? "Updating" : "Refresh"}
        </button>
      </div>

      <header className="flex gap-3">
        {product.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image_url} alt="" className="size-20 shrink-0 rounded-2xl border bg-muted object-cover" />
        )}
        <div className="min-w-0">
          <h1 className="text-xl leading-tight font-extrabold">{product.name}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {product.last_refresh_at ? `Live listings as of ${stampET(product.last_refresh_at)}` : "First check in progress"}
            {product.profile.release_date ? ` · Released ${product.profile.release_date}` : ""}
          </p>
          <div className="mt-1 flex gap-3 text-xs font-semibold">
            <a href={ebaySearchUrl(product.profile, true)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-600">
              eBay sold <ExternalLink className="size-3" />
            </a>
            <a href={ebaySearchUrl(product.profile, false)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-600">
              eBay live <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      </header>

      {track?.status === "running" && (
        <p className="flex items-center gap-2 rounded-2xl bg-brand-soft px-4 py-3 text-sm font-semibold text-ink">
          <Loader2 className="size-4 animate-spin" /> {stepLabel(track.step, track)}
        </p>
      )}
      {(track?.status === "error" || track?.status === "paused") && track.error && (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm">{track.error}</p>
      )}

      <section className="grid grid-cols-2 gap-3">
        <StatCard label="Sold median · 7d" value={usd(h.median7)} sub={`30d ${usd(h.median30)}`} />
        <StatCard label="Units sold · 30d" value={whole(h.sold30)} sub={`${whole(h.sold7)} in the last 7 days`} />
        <StatCard label="Live listings" value={whole(h.live)} sub={`Lowest ${usd(h.lowestBin)} · median ${usd(h.medianBin)}`} />
        <StatCard
          label="Sell-through · 30d"
          value={h.sellThrough == null ? "—" : `${Math.round(h.sellThrough)}%`}
          sub={h.daysSupply == null ? "Days of supply: —" : `${h.daysSupply.toFixed(1)} days of supply`}
        />
      </section>
      {h.unconfirmed > 0 && <p className="-mt-2 text-xs text-muted-foreground">{`${h.unconfirmed} live listings don't confirm the version, so they're left out of prices.`}</p>}

      <section className="flex flex-col gap-3 rounded-3xl border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Your numbers</h2>
          <VerdictBadge v={v} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-muted-foreground">
            Your cost
            <MoneyInput value={cost} onChange={setCost} placeholder="Enter cost" className="mt-1" />
          </label>
          <label className="text-xs font-semibold text-muted-foreground">
            Sale price
            <MoneyInput value={sale} onChange={setSale} placeholder={h.defaultSale.value ? h.defaultSale.value.toFixed(2) : "0.00"} className="mt-1" />
            <span className="mt-1 block font-normal">{sale ? "Your price" : h.defaultSale.source}</span>
          </label>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-muted/60 p-2">
            <dt className="text-[11px] font-bold text-muted-foreground uppercase">Profit</dt>
            <dd className={cn("font-mono font-bold", costNum > 0 && (calc.profit >= 0 ? "text-profit" : "text-loss"))}>{costNum > 0 ? usd(calc.profit) : "—"}</dd>
          </div>
          <div className="rounded-2xl bg-muted/60 p-2">
            <dt className="text-[11px] font-bold text-muted-foreground uppercase">ROI</dt>
            <dd className="font-mono font-bold">{calc.roi == null ? "—" : `${Math.round(calc.roi)}%`}</dd>
          </div>
          <div className="rounded-2xl bg-muted/60 p-2">
            <dt className="text-[11px] font-bold text-muted-foreground uppercase">Max cost</dt>
            <dd className="font-mono font-bold">{usd(max)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          eBay fees {DEFAULT_RESEARCH_FEES.feePct}% + ${DEFAULT_RESEARCH_FEES.perOrderFee.toFixed(2)}, ${DEFAULT_RESEARCH_FEES.yourShipping} shipping. Max cost hits {TARGET_ROI}% ROI. Fees {usd(calc.totalFees)}.
        </p>
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            className="h-11 w-16 rounded-2xl border bg-muted/60 text-center font-mono"
            aria-label="Quantity"
          />
          <button
            disabled={pending || !(costNum > 0)}
            onClick={() =>
              startTransition(async () => {
                const r = await addResearchToInventory(product.id, Math.round(costNum * 100), qty)
                if (!r.ok) toast.error(r.error)
                else toast.success("Added to inventory")
              })
            }
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-ink font-bold text-brand disabled:opacity-50"
          >
            <PackagePlus className="size-4" /> {watch?.item_id ? "Add more to inventory" : "Bought it: add to inventory"}
          </button>
        </div>
      </section>

      <SoldHistory productId={product.id} keywords={product.profile.keywords} collected={item.soldCollected} collectedAt={product.sold_collected_at} run={sold} />

      <div className="flex gap-1 self-end rounded-2xl border bg-card p-1">
        {RANGES.map((r) => (
          <button
            key={r.label}
            onClick={() => setRange(r.days)}
            className={cn("rounded-xl px-3 py-1 text-sm font-semibold", range === r.days ? "bg-ink text-brand" : "text-muted-foreground")}
          >
            {r.label}
          </button>
        ))}
      </div>
      <DayChart
        title="Price"
        days={shown.map((d) => d.day)}
        zeroBased={false}
        format={(n) => `$${Math.round(n)}`}
        series={[
          { key: "median", label: "Sold (7-day median)", color: "var(--viz-1)", kind: "line", values: shown.map((d) => d.median7) },
          { key: "lowest", label: "Lowest Buy It Now", color: "var(--viz-2)", kind: "line", values: shown.map((d) => d.lowest) },
        ]}
      />
      <DayChart
        title="Units sold per day"
        days={shown.map((d) => d.day)}
        format={(n) => whole(n)}
        series={[{ key: "sold", label: "Units sold", color: "var(--viz-1)", kind: "bar", values: shown.map((d) => d.sold) }]}
      />
      <DayChart
        title="Live listings"
        days={shown.map((d) => d.day)}
        format={(n) => whole(n)}
        series={[{ key: "live", label: "Live listings", color: "var(--viz-1)", kind: "line", values: shown.map((d) => d.live) }]}
      />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-muted-foreground uppercase">Cheapest Buy It Now</h2>
        {offers.length === 0 && <p className="text-sm text-muted-foreground">No live Buy It Now listings yet.</p>}
        {offers.map((o) => (
          <a key={o.id} href={o.url ?? "#"} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl border bg-card p-2 pr-3">
            {o.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={o.image_url} alt="" className="size-12 shrink-0 rounded-xl bg-muted object-cover" />
            ) : (
              <span className="size-12 shrink-0 rounded-xl bg-muted" />
            )}
            <span className="min-w-0 flex-1">
              <span className="line-clamp-1 text-sm">{o.title}</span>
              <span className="text-xs text-muted-foreground">
                {o.seller ?? "seller"} {o.feedback != null ? `(${o.feedback})` : ""}
                {o.soldQty ? ` · ${o.soldQty} sold` : ""}
                {!o.confirmed ? " · version unconfirmed" : ""}
              </span>
            </span>
            <span className="font-mono font-bold">{usd(o.total)}</span>
          </a>
        ))}
        {(item.review > 0 || item.rejected > 0) && (
          <p className="text-xs text-muted-foreground">
            {item.rejected} listings were ruled out (other products, lots, graded…){item.review > 0 ? ` and ${item.review} are held for review` : ""}.
          </p>
        )}
      </section>

      <button
        onClick={() =>
          startTransition(async () => {
            const r = await unwatchResearch(product.id)
            if (!r.ok) toast.error(r.error)
            else router.push("/research")
          })
        }
        className="mb-4 text-sm font-semibold text-muted-foreground underline"
      >
        Remove from my list
      </button>
    </>
  )
}
