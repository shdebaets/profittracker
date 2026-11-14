"use client"

import { BarChart3, Bookmark, Loader2, PackagePlus, RefreshCw, ScanBarcode, Search, Trash2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { compLookup, refreshTracked, saveSoldComps, trackProduct, untrackProduct } from "@/app/(app)/actions/comps"
import { useEntry } from "@/components/entry/entry-provider"
import { MoneyInput } from "@/components/fields"
import type { CompLookup, CompPick } from "@/lib/comps/lookup"
import { buyProfit, type CompStats } from "@/lib/comps/stats"
import { relativeTime } from "@/lib/dates"
import { collectSoldWithExtension, extensionCanCollectComps, useExtension } from "@/lib/extension"
import { centsToInput, formatCents, toCents } from "@/lib/money"
import { cn } from "@/lib/utils"
import { Scanner } from "./scanner"

export type Tracked = {
  id: string
  query: string
  gtin: string | null
  title: string | null
  product: string | null
  image_url: string | null
  target_cost_cents: number | null
  stats: CompStats | null
  checked_at: string | null
}

const SOURCE_LABEL = { sold30: "30-day sold median", sold90: "90-day sold median", active: "live listings (no sold data yet)" } as const

export function CompView({ tracked, initialQuery }: { tracked: Tracked[]; initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery)
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<CompLookup | null>(null)
  const [pick, setPick] = useState<CompPick | null>(null)
  const [cost, setCost] = useState("")
  const [pending, start] = useTransition()
  const [collecting, setCollecting] = useState(false)
  const ext = useExtension()
  const { openEntry } = useEntry()

  const lookup = useCallback((q: string, product?: string | null) => {
    if (q.trim().length < 2) return
    start(async () => {
      const res = await compLookup(q, product)
      if (!res.ok) return void toast.error(res.error)
      if ("pick" in res) {
        setResult(null)
        setPick(res.pick)
      } else {
        setPick(null)
        setResult(res.lookup)
      }
    })
  }, [])

  // Opened with ?q= (header search, the calculator's "Full comp"): run it right away.
  const ranInitial = useRef(false)
  useEffect(() => {
    if (ranInitial.current || initialQuery.trim().length < 2) return
    ranInitial.current = true
    lookup(initialQuery)
  }, [initialQuery, lookup])

  const onCode = useCallback(
    (code: string) => {
      setScanning(false)
      setQuery(code)
      lookup(code)
    },
    [lookup],
  )

  async function pullSold(q: string) {
    setCollecting(true)
    try {
      const res = await collectSoldWithExtension(q)
      if (!res.ok) return void toast.error(res.error)
      const saved = await saveSoldComps(q, res.rows)
      if (!saved.ok) return void toast.error(saved.error)
      toast.success(`Read ${res.rows.length} sold listing${res.rows.length === 1 ? "" : "s"} from eBay`)
      lookup(result?.gtin ?? q, result?.gtin ? null : result?.product)
    } finally {
      setCollecting(false)
    }
  }

  const s = result?.stats
  const costCents = toCents(cost)
  const profit = s?.estimate != null && costCents > 0 ? buyProfit(costCents, s.estimate) : null
  const canCollect = !!ext.info && extensionCanCollectComps()

  return (
    <>
      {scanning ? (
        <Scanner onCode={onCode} onClose={() => setScanning(false)} />
      ) : (
        <button
          onClick={() => setScanning(true)}
          className="flex h-16 items-center justify-center gap-3 rounded-3xl bg-brand text-lg font-bold text-ink shadow-md shadow-brand/30"
        >
          <ScanBarcode className="size-6" /> Scan a barcode
        </button>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          lookup(query)
        }}
        className="flex gap-2"
      >
        <label className="flex h-12 flex-1 items-center gap-2 rounded-2xl border bg-card px-4">
          <Search className="size-5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="UPC or what it is"
            className="w-full bg-transparent outline-none"
          />
        </label>
        <button disabled={pending} className="h-12 rounded-2xl bg-ink px-4 font-bold text-white disabled:opacity-60">
          {pending ? <Loader2 className="size-5 animate-spin" /> : "Comp"}
        </button>
      </form>

      {pick && !result && (
        <section className="flex flex-col gap-2 rounded-3xl border bg-card p-4 shadow-sm">
          <p className="font-bold">Which one is it?</p>
          <p className="text-xs text-muted-foreground">&ldquo;{pick.query}&rdquo; matches a few different products. Pick yours so the price is for that exact item.</p>
          {pick.candidates.map((c) => (
            <button
              key={c.name}
              disabled={pending}
              onClick={() => lookup(pick.query, c.name)}
              className="flex items-center gap-3 rounded-2xl bg-muted/60 p-3 text-left disabled:opacity-60"
            >
              {c.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.image} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
              ) : (
                <span className="size-12 shrink-0 rounded-xl bg-muted" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{c.name}</span>
                <span className="block font-mono text-xs text-muted-foreground">
                  {c.lowCents != null ? `${formatCents(c.lowCents)}${c.highCents && c.highCents !== c.lowCents ? `–${formatCents(c.highCents)}` : ""} · ` : ""}
                  {c.count} listed
                </span>
              </span>
            </button>
          ))}
        </section>
      )}

      {result && s && (
        <section className="flex flex-col gap-4 rounded-3xl border bg-card p-5 shadow-sm">
          <div className="flex gap-3">
            {result.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={result.image} alt="" className="size-16 shrink-0 rounded-xl object-cover" />
            )}
            <div className="min-w-0">
              <p className="line-clamp-2 font-bold">{result.product}</p>
              <p className="text-xs text-muted-foreground">
                Searching eBay for &quot;{result.query}&quot;
                {!result.gtin && (
                  <>
                    {" · "}
                    <button type="button" onClick={() => lookup(query)} className="font-semibold text-brand">
                      Not it?
                    </button>
                  </>
                )}
              </p>
            </div>
          </div>

          {s.estimate == null ? (
            <p className="text-sm text-muted-foreground">No eBay listings found for this one. Try different words.</p>
          ) : (
            <>
              <div className="rounded-2xl bg-muted/60 p-4">
                <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Sells for about</p>
                <p className="font-mono text-3xl font-extrabold">{formatCents(s.estimate)}</p>
                <p className="text-xs text-muted-foreground">From the {SOURCE_LABEL[s.estimateSource!]}</p>
                {(s.newEstimate != null || s.usedEstimate != null) && (
                  <p className="mt-1 font-mono text-xs">
                    {s.newEstimate != null && <>New ~{formatCents(s.newEstimate)}</>}
                    {s.newEstimate != null && s.usedEstimate != null && " · "}
                    {s.usedEstimate != null && <>Used/open box ~{formatCents(s.usedEstimate)}</>}
                  </p>
                )}
                {result.filteredOut > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Left out {result.filteredOut} {result.filteredOut === 1 ? "listing" : "listings"} that weren&apos;t this exact item (cases, lots, parts, other models).
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Price on the shelf</label>
                <MoneyInput value={cost} onChange={setCost} placeholder="0.00" />
              </div>
              {profit && (
                <p className={cn("rounded-2xl px-4 py-3 font-semibold", profit.profit > 0 ? "bg-profit-soft text-profit" : "bg-loss/10 text-loss")}>
                  Buy at {formatCents(costCents)}, sells for ~{formatCents(s.estimate)}, profit ~{formatCents(profit.profit)}
                  <span className="block text-xs font-normal text-muted-foreground">
                    After eBay&apos;s 13.25% fee ({formatCents(profit.fees)}) and a $6 shipping label.
                  </span>
                </p>
              )}
              <div className="grid grid-cols-3 gap-2 text-center font-mono text-xs">
                <Stat label="sold 30d" value={String(s.sold30)} />
                <Stat label="live now" value={String(s.activeCount)} />
                <Stat label="sell-through" value={s.sellThrough == null ? "n/a" : `${Math.round(s.sellThrough * 100)}%`} />
                <Stat label="lowest live" value={s.activeLowest == null ? "n/a" : formatCents(s.activeLowest)} />
                <Stat label="sold median 90d" value={s.soldMedian90 == null ? "n/a" : formatCents(s.soldMedian90)} />
                <Stat label="days to sell out" value={s.daysOfSupply == null ? "n/a" : String(s.daysOfSupply)} />
              </div>
            </>
          )}

          <p className="text-xs text-muted-foreground">
            {result.soldCollectedAt ? `Sold prices read ${relativeTime(result.soldCollectedAt)}.` : "No sold prices for this yet."}{" "}
            {canCollect ? "" : "Sold prices are read on a computer with the FlipLedger extension; on your phone you see what's been read so far."}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {canCollect && (
              <button
                disabled={collecting}
                onClick={() => pullSold(result.query)}
                className="col-span-2 flex h-11 items-center justify-center gap-2 rounded-2xl border font-semibold disabled:opacity-60"
              >
                {collecting ? <Loader2 className="size-4 animate-spin" /> : <BarChart3 className="size-4" />} Read eBay sold prices
              </button>
            )}
            <button
              onClick={() =>
                openEntry("inventory", {
                  title: result.product,
                  cost: cost || "",
                })
              }
              className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-ink font-semibold text-white"
            >
              <PackagePlus className="size-4" /> I bought it
            </button>
            <button
              onClick={() =>
                start(async () => {
                  const res = await trackProduct({
                    query: result.query,
                    gtin: result.gtin,
                    title: result.product,
                    product: result.gtin ? null : result.product,
                    image: result.image,
                    targetCostCents: costCents || null,
                  })
                  if (res.ok) toast.success("Tracking it")
                  else toast.error(res.error)
                })
              }
              className="flex h-11 items-center justify-center gap-2 rounded-2xl border font-semibold"
            >
              <Bookmark className="size-4" /> Track
            </button>
          </div>
        </section>
      )}

      {tracked.length > 0 && <TrackedList tracked={tracked} onOpen={(t) => { setQuery(t.gtin ?? t.query); lookup(t.gtin ?? t.query, t.gtin ? null : t.product ?? t.query); if (t.target_cost_cents) setCost(centsToInput(t.target_cost_cents)) }} />}
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-2 py-2">
      <b className="block text-sm">{value}</b>
      <span className="text-muted-foreground">{label}</span>
    </div>
  )
}

function TrackedList({ tracked, onOpen }: { tracked: Tracked[]; onOpen: (t: Tracked) => void }) {
  const [pending, start] = useTransition()
  return (
    <section className="flex flex-col gap-2">
      <p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Tracked products</p>
      {tracked.map((t) => {
        const est = t.stats?.estimate ?? null
        const p = est != null && t.target_cost_cents ? buyProfit(t.target_cost_cents, est) : null
        return (
          <div key={t.id} className="flex items-center gap-3 rounded-2xl border bg-card p-3">
            <button onClick={() => onOpen(t)} className="min-w-0 flex-1 text-left">
              <span className="block truncate font-semibold">{t.title ?? t.query}</span>
              <span className="block font-mono text-xs text-muted-foreground">
                {est != null ? `~${formatCents(est)} · ${t.stats?.sold30 ?? 0} sold 30d` : "Not checked yet"}
                {p ? ` · ${p.profit > 0 ? "BUY" : "SKIP"} at ${formatCents(t.target_cost_cents!)}` : ""}
                {t.checked_at ? ` · ${relativeTime(t.checked_at)}` : ""}
              </span>
            </button>
            <button
              aria-label="Refresh"
              disabled={pending}
              onClick={() => start(async () => void (await refreshTracked(t.id)))}
              className="grid size-10 place-items-center rounded-xl text-muted-foreground"
            >
              <RefreshCw className={cn("size-4", pending && "animate-spin")} />
            </button>
            <button
              aria-label="Stop tracking"
              disabled={pending}
              onClick={() => start(async () => void (await untrackProduct(t.id)))}
              className="grid size-10 place-items-center rounded-xl text-muted-foreground"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        )
      })}
    </section>
  )
}
