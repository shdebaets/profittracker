"use client"

import { BarChart3, Bookmark, Camera, Check, Loader2, PackagePlus, RefreshCw, ScanBarcode, Search, Trash2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { compLookup, compPhotoIdentify, refreshTracked, trackProduct, untrackProduct } from "@/app/(app)/actions/comps"
import { createItem } from "@/app/(app)/actions/items"
import { useEntry } from "@/components/entry/entry-provider"
import { MoneyInput, NativeSelect, TextInput } from "@/components/fields"
import type { CompLookup, CompPick } from "@/lib/comps/lookup"
import { feeText, platformProfit, PROFIT_PLATFORMS, profitPlatform } from "@/lib/comps/profit"
import { buyProfit, DEFAULT_LABEL_CENTS, type CompStats } from "@/lib/comps/stats"
import { compressImage } from "@/lib/image"
import type { MarketplaceId } from "@/lib/marketplaces/registry"
import { relativeTime } from "@/lib/dates"
import { CompDetails } from "@/components/comp-details"
import { useExtension } from "@/lib/extension"
import { EXTENSION_STORE_URL } from "@/lib/marketplaces/registry"
import { BROWSER_SOLD_READS, pullSoldHere, soldIsStale, soldSource } from "@/lib/sold-browser"
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

// Per-device choices for the profit box and "I bought it".
const STORE_KEY = "fl:lastStore"
const PLATFORM_KEY = "fl:comp:platform"
const SHIP_KEY = "fl:comp:ship"
const readLocal = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const writeLocal = (k: string, v: string) => {
  try {
    if (v) localStorage.setItem(k, v)
    else localStorage.removeItem(k)
  } catch {}
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })

const SOURCE_LABEL = { recent: "last 20 sales (it's selling fast, so older prices are skipped)", sold30: "30-day sold median", sold90: "90-day sold median", active: "live listings (no sold data yet)" } as const

export function CompView({ tracked, initialQuery }: { tracked: Tracked[]; initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery)
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<CompLookup | null>(null)
  const [pick, setPick] = useState<CompPick | null>(null)
  // Products this member can still check today (5 a day for now; null = no limit).
  const [checksLeft, setChecksLeft] = useState<number | null>(null)
  const [cost, setCost] = useState("")
  const [pending, start] = useTransition()
  const [collecting, setCollecting] = useState(false)
  const [store, setStore] = useState("")
  const [platform, setPlatform] = useState<MarketplaceId>("ebay")
  const [ship, setShip] = useState(centsToInput(DEFAULT_LABEL_CENTS))
  const [photoBusy, setPhotoBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const ext = useExtension()

  // Remembered on this device: the last store, and the platform and shipping in the profit box.
  useEffect(() => {
    const t = setTimeout(() => {
      setStore(readLocal(STORE_KEY) ?? "")
      setPlatform(profitPlatform(readLocal(PLATFORM_KEY)).id)
      const sh = readLocal(SHIP_KEY)
      if (sh != null) setShip(sh)
    }, 0)
    return () => clearTimeout(t)
  }, [])
  const { openEntry } = useEntry()

  // Desktop with the extension, or the phone app: this device reads eBay's sold prices itself.
  const source = soldSource(!!ext.info)
  const runLookup = useCallback(
    async (q: string, product?: string | null, paidFallback = false) => {
      const res = await compLookup(q, product, !!source && !paidFallback)
      if (!res.ok) return void toast.error(res.error)
      if ("pick" in res) {
        setResult(null)
        setPick(res.pick)
      } else {
        setPick(null)
        setResult(res.lookup)
        setChecksLeft(res.checksLeft)
      }
    },
    [source],
  )
  const lookup = useCallback(
    (q: string, product?: string | null, paidFallback = false) => {
      if (q.trim().length < 2) return
      start(() => runLookup(q, product, paidFallback))
    },
    [runLookup],
  )

  // Opened with ?q= (header search, the calculator's "Full comp"): run it right away.
  const ranInitial = useRef(false)
  useEffect(() => {
    if (ranInitial.current || initialQuery.trim().length < 2) return
    // Give the extension a moment to say it's here, so a desktop with it doesn't use the paid data.
    const t = setTimeout(() => {
      if (ranInitial.current) return
      ranInitial.current = true
      lookup(initialQuery)
    }, 500)
    return () => clearTimeout(t)
  }, [initialQuery, lookup])

  // Photo scan: Claude names the product, then the normal search (and picker) runs on it.
  async function onPhoto(file: File | undefined) {
    if (!file) return
    setPhotoBusy(true)
    try {
      const jpeg = await compressImage(file, 0.75, 1024)
      const res = await compPhotoIdentify(await blobToDataUrl(jpeg))
      if (!res.ok) return void toast.error(res.error)
      const q = res.barcode ?? res.search
      setQuery(q)
      toast.success(`Looks like ${res.product}`)
      lookup(q)
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't read that photo. Try again.")
    } finally {
      setPhotoBusy(false)
      if (photoInput.current) photoInput.current.value = ""
    }
  }

  const onCode = useCallback(
    (code: string) => {
      setScanning(false)
      setQuery(code)
      lookup(code)
    },
    [lookup],
  )

  async function pullSold(q: string) {
    if (!source) return
    setCollecting(true)
    try {
      const same = result?.query === q
      // Never read (or over a day ago): page deep; otherwise the newest pages pick up what's new.
      const deep = !same || !result?.soldCollectedAt || Date.now() - Date.parse(result.soldCollectedAt) > 24 * 3_600_000
      const res = await pullSoldHere(source, q, same ? result?.searches : undefined, deep)
      // Re-run the comp with the new sales and wait for it, so the card never shows "no sold data"
      // next to a toast saying they were read (and the spinner stays until the numbers land).
      const again = (paid: boolean) => runLookup(result?.gtin ?? q, result?.gtin ? null : result?.product, paid)
      // eBay blocked the read (signed out, captcha): fall back to the server's data for this one.
      if (!res.ok) {
        toast.error(res.error)
        return await again(true)
      }
      await again(false)
      toast.success(`Read ${res.count} sold listing${res.count === 1 ? "" : "s"} from eBay`)
    } finally {
      setCollecting(false)
    }
  }

  const s = result?.stats
  const costCents = toCents(cost)
  const shipCents = toCents(ship)
  const plat = profitPlatform(platform)
  const profit = s?.estimate != null && costCents > 0 ? platformProfit(costCents, s.estimate, platform, shipCents) : null
  const savedHere = !!result && saved === result.query

  function saveNow() {
    if (!result || s?.estimate == null) return
    if (costCents <= 0) return void toast.error("Enter the price on the shelf first")
    setSaving(true)
    writeLocal(STORE_KEY, store.trim())
    createItem({ mode: "inventory", title: result.product, store: store.trim() || undefined, costCents, quantity: 1, listPriceCents: s.estimate })
      .then((res) => {
        if (!res.ok) return void toast.error(res.error)
        setSaved(result.query)
        toast.success(`Added to inventory at ${formatCents(costCents)}`)
      })
      .finally(() => setSaving(false))
  }
  const canCollect = !!source

  // With the extension on this computer, read eBay's sold listings by itself when there are none
  // or they're over 12 hours old (CompAmp's auto-pull). Once per product per visit.
  const autoPulled = useRef(new Set<string>())
  useEffect(() => {
    if (!result || !canCollect || collecting || autoPulled.current.has(result.query)) return
    if (!soldIsStale(result.soldCollectedAt)) return
    const q = result.query
    const t = setTimeout(() => {
      if (autoPulled.current.has(q)) return
      autoPulled.current.add(q)
      void pullSold(q)
    }, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, canCollect])

  return (
    <>
      {scanning ? (
        <Scanner onCode={onCode} onClose={() => setScanning(false)} />
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => setScanning(true)}
            className="flex h-16 flex-1 items-center justify-center gap-3 rounded-3xl bg-brand text-lg font-bold text-ink shadow-md shadow-brand/30"
          >
            <ScanBarcode className="size-6" /> Scan a barcode
          </button>
          <button
            type="button"
            disabled={photoBusy || pending}
            onClick={() => photoInput.current?.click()}
            aria-label="Snap a photo"
            className="flex h-16 w-24 shrink-0 flex-col items-center justify-center gap-0.5 rounded-3xl border-2 border-brand bg-card text-xs font-bold disabled:opacity-60"
          >
            {photoBusy ? <Loader2 className="size-6 animate-spin" /> : <Camera className="size-6" />}
            {photoBusy ? "Looking…" : "Photo"}
          </button>
          <input ref={photoInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onPhoto(e.target.files?.[0])} />
        </div>
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
                {result.searches.length > 1 ? `Checked ${result.searches.length} eBay searches` : <>Searching eBay for &quot;{result.query}&quot;</>}
                {result.otherEditions.length > 0 && <> · not the {result.otherEditions.slice(0, 3).join(", ")} version</>}
                {!result.gtin && (
                  <>
                    {" · "}
                    <button type="button" onClick={() => lookup(query)} className="font-semibold text-brand">
                      Not it?
                    </button>
                  </>
                )}
              </p>
              {checksLeft != null && (
                <p className="text-xs text-muted-foreground">
                  {checksLeft === 0 ? "That was your last new product check today" : `${checksLeft} new product check${checksLeft === 1 ? "" : "s"} left today`}
                </p>
              )}
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
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Price on the shelf</label>
                  <MoneyInput value={cost} onChange={setCost} placeholder="0.00" />
                </div>
                <div>
                  <label htmlFor="comp-store" className="text-xs font-semibold text-muted-foreground">Store</label>
                  <TextInput
                    id="comp-store"
                    value={store}
                    onChange={(e) => setStore(e.target.value)}
                    onBlur={() => writeLocal(STORE_KEY, store.trim())}
                    placeholder="Walmart"
                    maxLength={100}
                  />
                </div>
                <div>
                  <label htmlFor="comp-platform" className="text-xs font-semibold text-muted-foreground">Selling on</label>
                  <NativeSelect
                    id="comp-platform"
                    value={platform}
                    onChange={(e) => {
                      const p = profitPlatform(e.target.value).id
                      setPlatform(p)
                      writeLocal(PLATFORM_KEY, p)
                    }}
                  >
                    {PROFIT_PLATFORMS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Shipping label</label>
                  <MoneyInput
                    value={ship}
                    onChange={(v) => {
                      setShip(v)
                      writeLocal(SHIP_KEY, v)
                    }}
                    placeholder="0.00"
                  />
                </div>
              </div>
              {profit && (
                <p className={cn("rounded-2xl px-4 py-3 font-semibold", profit.profit > 0 ? "bg-profit-soft text-profit" : "bg-loss/10 text-loss")}>
                  Buy at {formatCents(costCents)}, sells for ~{formatCents(s.estimate)}, profit ~{formatCents(profit.profit)}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {feeText(plat) === "no fee" ? `No ${plat.label} fee` : `After ${plat.label}'s ${feeText(plat)} fee (${formatCents(profit.fees)})`}
                    {profit.label ? ` and a ${formatCents(profit.label)} shipping label` : ", no shipping label"}. Sale price from eBay.
                  </span>
                </p>
              )}
              <div className="grid grid-cols-3 gap-2 text-center font-mono text-xs">
                {/* "+": multi-unit listings are still being counted from daily readings (a floor). */}
                <Stat label="sold 7d" value={s.sold7Partial ? `${s.sold7}+` : s.sold30Estimated ? `~${s.sold7}` : String(s.sold7)} />
                <Stat
                  label={s.sold30Estimated ? "sold 30d (pace)" : "sold 30d"}
                  value={s.sold30Estimated ? `~${s.sold30}` : s.sold30Partial ? `${s.sold30}+` : String(s.sold30)}
                />
                <Stat label="live now" value={String(s.activeCount)} />
                <Stat label="sell-through" value={s.sellThrough == null ? "n/a" : `${Math.round(s.sellThrough * 100)}%`} />
                <Stat label="days of supply" value={s.daysOfSupply == null ? "n/a" : String(s.daysOfSupply)} />
                <Stat label="lowest live" value={s.activeLowest == null ? "n/a" : formatCents(s.activeLowest)} />
                <Stat label="sold median 30d" value={s.soldMedian30 == null ? "n/a" : formatCents(s.soldMedian30)} />
                <Stat label="sold median 90d" value={s.soldMedian90 == null ? "n/a" : formatCents(s.soldMedian90)} />
                <Stat label="sold 90d" value={s.sold90Partial ? `${s.sold90}+` : String(s.sold90)} />
              </div>
              <p className="-mt-2 text-xs text-muted-foreground">
                Sold counts are units, not listings: {s.soldListings30} sold {s.soldListings30 === 1 ? "listing" : "listings"} in 30 days
                {s.multiUnitListings > 0 ? `, ${s.multiUnitListings} of them selling more than one` : ""}. Days of supply: how long today&apos;s live listings would take to sell at the last 30 days&apos; pace.
                {s.sold7Partial && s.countingSince && (
                  <>
                    {" "}
                    Counts with a + are still filling in: listings that sell more than one are counted from daily readings that started{" "}
                    {new Date(s.countingSince + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}, so the real number is at least this.
                  </>
                )}
              </p>
            </>
          )}

          <CompDetails history={result.history} />
          {BROWSER_SOLD_READS && !canCollect && <ExtensionNudge outdated={!!ext.info} />}
          <p className="text-xs text-muted-foreground">
            {result.soldCollectedAt ? `Sold prices read ${relativeTime(result.soldCollectedAt)}.` : "No sold prices for this yet."}{" "}
            {canCollect
              ? collecting
                ? "Reading eBay's sold listings now…"
                : ""
              : result.soldCollectedAt
                ? ""
                : "eBay had no recent sales we could read for this one."}
          </p>
          {result.searches.length > 1 && (
            <details className="rounded-2xl bg-muted/60 p-3 text-xs">
              <summary className="cursor-pointer font-semibold">eBay searches checked ({result.searches.length})</summary>
              <ul className="mt-2 flex flex-col gap-1 font-mono">
                {result.searches.map((q) => (
                  <li key={q} className="truncate">{q}</li>
                ))}
              </ul>
              <p className="mt-2 text-muted-foreground">Sellers title the same item many ways, so every one of these is read and each listing counted once.</p>
            </details>
          )}
          {result.recentSales.length > 0 && (
            <details className="rounded-2xl bg-muted/60 p-3 text-xs">
              <summary className="cursor-pointer font-semibold">Recent sales behind this price ({result.recentSales.length})</summary>
              <ul className="mt-2 flex flex-col gap-1.5">
                {result.recentSales.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-12 shrink-0 font-mono text-muted-foreground">{r.soldOn.slice(5)}</span>
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    <span className="shrink-0 font-mono">
                      {formatCents(r.priceCents + (r.shippingCents ?? 0))}
                      {r.bestOffer ? " BO" : ""}
                    </span>
                  </li>
                ))}
              </ul>
              {result.droppedSales.length > 0 && (
                <>
                  <p className="mt-3 font-semibold text-muted-foreground">Left out (not this exact item)</p>
                  <ul className="mt-1 flex flex-col gap-1 text-muted-foreground">
                    {result.droppedSales.map((r, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="w-12 shrink-0 font-mono">{r.soldOn.slice(5)}</span>
                        <span className="min-w-0 flex-1 truncate line-through">{r.title}</span>
                        <span className="shrink-0 font-mono">{formatCents(r.priceCents)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mt-2 text-muted-foreground">Prices include shipping. Best-offer sales show the asking price, because eBay hides the accepted amount, so they&apos;re left out of the median.</p>
            </details>
          )}
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
              onClick={() => {
                writeLocal(STORE_KEY, store.trim())
                openEntry("inventory", {
                  title: result.product,
                  cost: cost || "",
                  store: store.trim(),
                  price: s.estimate != null ? centsToInput(s.estimate) : "",
                })
              }}
              className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-ink font-semibold text-white"
            >
              <PackagePlus className="size-4" /> I bought it
            </button>
            <button
              disabled={saving || savedHere || s.estimate == null}
              onClick={saveNow}
              className="flex h-11 items-center justify-center gap-2 rounded-2xl border-2 border-ink font-semibold disabled:opacity-60"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : savedHere ? <Check className="size-4" /> : null}
              {savedHere ? "Saved" : "Save now"}
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
              className="col-span-2 flex h-11 items-center justify-center gap-2 rounded-2xl border font-semibold"
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

/**
 * On a computer without the extension (or with one too old to read sold prices): sold prices then
 * come from the paid data service, which can't see best offers or units. Point them to the extension.
 */
function ExtensionNudge({ outdated }: { outdated: boolean }) {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setDesktop(window.matchMedia("(pointer: fine)").matches), 0)
    return () => clearTimeout(t)
  }, [])
  if (!desktop) return null
  return (
    <a
      href={EXTENSION_STORE_URL}
      target="_blank"
      rel="noreferrer"
      className="flex flex-col gap-0.5 rounded-2xl border border-brand/40 bg-brand/10 px-4 py-3 text-sm"
    >
      <span className="font-semibold">{outdated ? "Update the FlipLedger Chrome extension" : "Add the FlipLedger Chrome extension"} for exact sold prices</span>
      <span className="text-xs text-muted-foreground">
        It reads eBay&apos;s sold listings in your own signed-in Chrome: free, and it spots best offers. Without it these numbers come from a data service.
      </span>
    </a>
  )
}
