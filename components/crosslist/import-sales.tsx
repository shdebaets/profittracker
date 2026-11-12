"use client"

import { Loader2, ShoppingBag } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { previewSales, recordSales, type SalesPreview } from "@/app/(app)/actions/import"
import { extensionCanImportSales, importSalesWithExtension, useExtension } from "@/lib/extension"
import { EXTENSION_STORE_URL } from "@/lib/marketplaces/registry"
import type { MarketplaceSale } from "@/lib/sales/untracked"
import { GENERIC_ERROR } from "@/lib/errors"

// Server actions accept about 1MB, so sales go up in batches.
const BATCH = 50
const batches = (list: MarketplaceSale[]) => Array.from({ length: Math.ceil(list.length / BATCH) }, (_, i) => list.slice(i * BATCH, (i + 1) * BATCH))

/**
 * Record Mercari sales of items FlipLedger didn't track (listed straight on Mercari).
 * They come in as sold items marked "Add cost". eBay does this by itself on every sync.
 */
export function ImportSales() {
  const ext = useExtension()
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<SalesPreview | null>(null)

  async function find() {
    setBusy("Reading your Mercari sales. Leave the Mercari tab open until it closes by itself…")
    const found = await importSalesWithExtension("mercari")
    if (!found.ok) return setBusy(null) // The extension bridge already showed the error.
    if (!found.sales.length) {
      setBusy(null)
      return void toast.error("No Mercari sales found. Make sure you're logged in to Mercari in this Chrome window.")
    }
    const total: SalesPreview = { sales: found.sales, create: 0, skip: 0 }
    for (const part of batches(found.sales)) {
      const res = await previewSales(part)
      if (!res.ok) {
        setBusy(null)
        return void toast.error(res.error)
      }
      total.create += res.data.create
      total.skip += res.data.skip
    }
    setBusy(null)
    setPreview(total)
  }

  async function record() {
    if (!preview) return
    const parts = batches(preview.sales)
    let created = 0
    for (const [i, part] of parts.entries()) {
      setBusy(`Recording… ${Math.min((i + 1) * BATCH, preview.sales.length)} of ${preview.sales.length}`)
      const res = await recordSales(part)
      if (!res.ok) {
        setBusy(null)
        return void toast.error(`${res.error ?? GENERIC_ERROR} ${created ? `(${created} recorded before that)` : ""}`.trim())
      }
      created += res.data.created
    }
    setBusy(null)
    setPreview(null)
    toast.success(`Recorded ${created} Mercari sale${created === 1 ? "" : "s"}.${created ? " Add what you paid under Inventory › Needs Cost." : ""}`)
  }

  const can = ext.supports("mercari") && extensionCanImportSales()
  const btn = "flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-bold disabled:opacity-60"

  return (
    <div className="flex flex-col gap-3 rounded-2xl border p-4">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold"><ShoppingBag className="size-4" /> Bring in sales FlipLedger missed</p>
        <p className="text-xs text-muted-foreground">
          eBay sales come in by themselves when you sync, even for items you listed straight on eBay. For Mercari, the extension reads your sold items. Sales of items FlipLedger didn&apos;t know about come in marked Add cost, so you can enter what you paid.
        </p>
      </div>

      {preview ? (
        <div className="flex flex-col gap-3 rounded-xl bg-muted/60 p-3">
          <p className="text-sm">
            Found <b>{preview.sales.length}</b> sold Mercari item{preview.sales.length === 1 ? "" : "s"}:
          </p>
          <ul className="list-disc pl-5 text-sm">
            <li>{preview.create} new sale{preview.create === 1 ? "" : "s"} to record</li>
            {preview.skip > 0 && <li>{preview.skip} already in FlipLedger (skipped)</li>}
          </ul>
          <div className="flex gap-2">
            <button disabled={!!busy || preview.create === 0} onClick={record} className={`${btn} flex-1 bg-brand text-ink`}>
              {busy && <Loader2 className="size-4 animate-spin" />} {busy ?? "Record sales"}
            </button>
            <button disabled={!!busy} onClick={() => setPreview(null)} className={`${btn} border bg-card`}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <button disabled={!!busy || !can} onClick={find} className={`${btn} bg-red-500 text-white`}>
            Find Mercari sales
          </button>
          <p className="text-xs text-muted-foreground">
            {can
              ? "Needs this computer: the extension reads your sold items while you're logged in to Mercari in Chrome. It only reads; it doesn't change anything on Mercari."
              : ext.info
                ? "This needs the newest FlipLedger extension. Update it in chrome://extensions."
                : <>This needs the <a href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer" className="font-semibold underline">FlipLedger Chrome extension</a> on a computer.</>}
          </p>
          {busy && <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> {busy}</p>}
        </>
      )}
    </div>
  )
}
