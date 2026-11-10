"use client"

import { Calculator, Loader2, Search, Sparkles } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { searchResearch, startResearch, watchResearch, type SearchResult } from "@/app/(app)/actions/research"
import { PageTitle } from "@/components/app-header"
import type { Candidate } from "@/lib/research/ai"
import { profitAt, DEFAULT_RESEARCH_FEES, verdict } from "@/lib/research/calc"
import type { getResearchList } from "@/lib/research/data"
import { cn } from "@/lib/utils"

type ListRow = Awaited<ReturnType<typeof getResearchList>>[number]
const usd = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toFixed(2)}`)

export function VerdictBadge({ v }: { v: "BUY" | "THIN" | "SKIP" | null }) {
  if (!v) return null
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide",
        v === "BUY" && "bg-profit-soft text-profit",
        v === "THIN" && "bg-brand-soft text-ink",
        v === "SKIP" && "bg-muted text-muted-foreground",
      )}
    >
      {v}
    </span>
  )
}

export function ResearchView({ list, initialQuery }: { list: ListRow[]; initialQuery: string }) {
  const router = useRouter()
  const [q, setQ] = useState(initialQuery)
  const [result, setResult] = useState<Extract<SearchResult, { ok: true }> | null>(null)
  const [searching, startSearch] = useTransition()
  const [starting, setStarting] = useState<string | null>(null)
  const ran = useRef(false)

  function run(query: string) {
    if (query.trim().length < 2) return
    startSearch(async () => {
      const r = await searchResearch(query)
      if (!r.ok) toast.error(r.error)
      else setResult(r)
    })
  }
  useEffect(() => {
    if (initialQuery && !ran.current) {
      ran.current = true
      run(initialQuery)
    }
  }, [initialQuery])

  async function research(c: Candidate) {
    setStarting(c.name)
    const r = await startResearch(q, c)
    setStarting(null)
    if (!r.ok) return toast.error(r.error)
    router.push(`/research/${r.id}`)
  }

  async function open(id: string) {
    const r = await watchResearch(id)
    if (!r.ok) return toast.error(r.error)
    router.push(`/research/${id}`)
  }

  return (
    <>
      <PageTitle title="Research" subtitle="What it sells for on eBay, how fast, and what you can pay.">
        <Link href="/calculator" className="grid size-11 shrink-0 place-items-center rounded-2xl border bg-card text-muted-foreground" aria-label="Profit calculator">
          <Calculator className="size-5" />
        </Link>
      </PageTitle>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          run(q)
        }}
        className="flex gap-2"
      >
        <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-2xl border bg-card px-4 focus-within:ring-2 focus-within:ring-brand/30">
          <Search className="size-5 shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Product name, set or UPC"
            className="w-full min-w-0 bg-transparent outline-none"
            enterKeyHint="search"
          />
        </label>
        <button type="submit" disabled={searching} className="h-12 rounded-2xl bg-brand px-5 font-bold text-ink disabled:opacity-60">
          {searching ? <Loader2 className="size-5 animate-spin" /> : "Search"}
        </button>
      </form>

      {searching && <p className="text-sm text-muted-foreground">Reading eBay results… this takes about 10 seconds.</p>}

      {result && !searching && (
        <section className="flex flex-col gap-3">
          {result.existing.length > 0 && (
            <>
              <h2 className="text-sm font-bold text-muted-foreground uppercase">Already researched · free</h2>
              {result.existing.map((p) => (
                <button key={p.id} onClick={() => open(p.id)} className="flex items-center gap-3 rounded-3xl border bg-card p-3 text-left shadow-sm">
                  <Thumb src={p.image_url} />
                  <span className="min-w-0 flex-1 font-semibold">{p.name}</span>
                </button>
              ))}
            </>
          )}
          <h2 className="flex items-center justify-between text-sm font-bold text-muted-foreground uppercase">
            <span>Products found on eBay</span>
            {result.checksLeft != null && <span className="normal-case">{result.checksLeft} free checks left today</span>}
          </h2>
          {result.candidates.length === 0 && <p className="text-sm text-muted-foreground">Nothing matched. Try different words.</p>}
          {result.candidates.map((c) => (
            <div key={c.name} className="flex flex-col gap-3 rounded-3xl border bg-card p-4 shadow-sm">
              <div className="flex gap-3">
                <Thumb src={c.image_url} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug">{c.name}</p>
                  <p className="text-sm text-muted-foreground">{c.description}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {c.count} listings · {usd(c.price_low)}–{usd(c.price_high)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => research(c)}
                disabled={!!starting || result.checksLeft === 0}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-ink font-bold text-brand disabled:opacity-50"
              >
                {starting === c.name ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {starting === c.name ? "Setting up…" : "Research this"}
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-muted-foreground uppercase">Your list</h2>
        {list.length === 0 && (
          <p className="rounded-3xl border border-dashed p-5 text-sm text-muted-foreground">
            {"Search for something you're thinking of buying. You'll see what it really sells for, how many sell a day, and the most you can pay."}
          </p>
        )}
        {list.map((p) => {
          const s = p.summary
          const sale = s?.defaultSale?.value ?? null
          const cost = p.cost_cents != null ? p.cost_cents / 100 : null
          const roi = sale != null && cost ? profitAt(sale, 0, cost, DEFAULT_RESEARCH_FEES).roi : null
          return (
            <Link key={p.id} href={`/research/${p.id}`} className="flex gap-3 rounded-3xl border bg-card p-3 shadow-sm">
              <Thumb src={p.image_url} />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 font-semibold leading-snug">{p.name}</p>
                {s ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {usd(s.median7 ?? s.median30)} sold · {s.sold30} sold/30d · {s.live} live
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">{p.last_status === "running" ? "Researching…" : "Waiting for data"}</p>
                )}
              </div>
              <VerdictBadge v={verdict(roi)} />
            </Link>
          )
        })}
      </section>
    </>
  )
}

function Thumb({ src }: { src: string | null }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="size-14 shrink-0 rounded-2xl border bg-muted object-cover" />
  ) : (
    <span className="size-14 shrink-0 rounded-2xl border bg-muted" />
  )
}
