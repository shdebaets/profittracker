"use client"

import { Loader2, ScanBarcode, Search } from "lucide-react"
import Link from "next/link"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { compLookup } from "@/app/(app)/actions/comps"
import { Scanner } from "@/app/(app)/comp/scanner"
import type { CompLookup, CompPick } from "@/lib/comps/lookup"
import { formatCents } from "@/lib/money"

/**
 * Profit Calculator's "What does it sell for?": scan or type, pick the product if the words are
 * loose, and the eBay estimate goes into the Sale Price.
 */
export function CompFill({ onPrice }: { onPrice: (cents: number) => void }) {
  const [q, setQ] = useState("")
  const [scanning, setScanning] = useState(false)
  const [pick, setPick] = useState<CompPick | null>(null)
  const [found, setFound] = useState<CompLookup | null>(null)
  const [pending, start] = useTransition()

  const run = (input: string, product?: string) =>
    start(async () => {
      const res = await compLookup(input, product)
      if (!res.ok) return void toast.error(res.error)
      if ("pick" in res) {
        setFound(null)
        return setPick(res.pick)
      }
      setPick(null)
      setFound(res.lookup)
      if (res.lookup.stats.estimate != null) onPrice(res.lookup.stats.estimate)
      else toast.message("No eBay listings found for this one. Try different words.")
    })

  return (
    <section className="flex flex-col gap-3 rounded-3xl border bg-card p-5 shadow-sm">
      <p className="text-sm font-bold tracking-widest text-blue-950 uppercase">What does it sell for?</p>
      {scanning ? (
        <Scanner
          onCode={(code) => {
            setScanning(false)
            setQ(code)
            run(code)
          }}
          onClose={() => setScanning(false)}
        />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (q.trim().length >= 2) run(q)
          }}
          className="flex gap-2"
        >
          <button type="button" onClick={() => setScanning(true)} aria-label="Scan a barcode" className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand text-ink">
            <ScanBarcode className="size-5" />
          </button>
          <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-2xl border bg-muted/60 px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="UPC or what it is" className="w-full min-w-0 bg-transparent outline-none" />
          </label>
          <button disabled={pending} className="h-12 shrink-0 rounded-2xl bg-ink px-4 font-bold text-white disabled:opacity-60">
            {pending ? <Loader2 className="size-5 animate-spin" /> : "Comp"}
          </button>
        </form>
      )}

      {pick && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Which one is it?</p>
          {pick.candidates.map((c) => (
            <button
              key={c.name}
              disabled={pending}
              onClick={() => run(pick.query, c.name)}
              className="flex items-center justify-between gap-2 rounded-2xl bg-muted/60 px-3 py-2 text-left text-sm disabled:opacity-60"
            >
              <span className="min-w-0 font-semibold">{c.name}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{c.lowCents != null ? formatCents(c.lowCents) : ""}</span>
            </button>
          ))}
        </div>
      )}

      {found && found.stats.estimate != null && (
        <p className="text-sm">
          <b>{found.product}</b> sells for about <b className="font-mono">{formatCents(found.stats.estimate)}</b> on eBay
          {found.stats.estimateSource === "active" ? " (from live listings)" : " (sold median)"}. Put in the Sale Price below.{" "}
          <Link href={`/comp?q=${encodeURIComponent(found.gtin ?? q)}`} className="font-semibold text-brand">
            Full comp →
          </Link>
        </p>
      )}
      {!found && !pick && (
        <p className="text-xs text-muted-foreground">Scan or type it and FlipLedger fills in the Sale Price from eBay.</p>
      )}
    </section>
  )
}
