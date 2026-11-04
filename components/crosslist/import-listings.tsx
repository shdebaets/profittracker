"use client"

import { Download, Loader2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { findPoshmarkListings, importListings, previewImport, type ImportPreview } from "@/app/(app)/actions/import"
import { TextInput } from "@/components/fields"
import { extensionCanImport, EXTENSION_STORE_URL, importWithExtension, useExtension } from "@/lib/extension"
import type { ImportCandidate } from "@/lib/import/plan"
import { GENERIC_ERROR } from "@/lib/errors"

// Server actions accept about 1MB, so listings go up in batches.
const BATCH = 50
const batches = (list: ImportCandidate[]) => Array.from({ length: Math.ceil(list.length / BATCH) }, (_, i) => list.slice(i * BATCH, (i + 1) * BATCH))

type Source = "poshmark" | "mercari"
const NAMES: Record<Source, string> = { poshmark: "Poshmark", mercari: "Mercari" }

/** Bring a seller's live Poshmark and Mercari listings into FlipLedger as inventory. */
export function ImportListings() {
  const ext = useExtension()
  const [closet, setCloset] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<(ImportPreview & { source: Source }) | null>(null)

  async function findPoshmark() {
    setBusy("Reading your closet…")
    const res = await findPoshmarkListings(closet)
    setBusy(null)
    if (res.ok) setPreview({ ...res.data, source: "poshmark" })
    else toast.error(res.error)
  }

  async function findMercari() {
    setBusy("Reading your Mercari listings. Leave the Mercari tab open until it closes by itself…")
    const found = await importWithExtension("mercari")
    if (!found.ok) return setBusy(null) // The extension bridge already showed the error.
    if (!found.candidates.length) {
      setBusy(null)
      return void toast.error("No live Mercari listings found. Make sure you're logged in to Mercari in this Chrome window.")
    }
    const total = { candidates: found.candidates, create: 0, link: 0, skip: 0 }
    for (const part of batches(found.candidates)) {
      const res = await previewImport(part)
      if (!res.ok) {
        setBusy(null)
        return void toast.error(res.error)
      }
      total.create += res.data.create
      total.link += res.data.link
      total.skip += res.data.skip
    }
    setBusy(null)
    setPreview({ ...total, source: "mercari" })
  }

  async function runImport() {
    if (!preview) return
    const parts = batches(preview.candidates)
    let created = 0
    let linked = 0
    for (const [i, part] of parts.entries()) {
      setBusy(`Importing… ${Math.min((i + 1) * BATCH, preview.candidates.length)} of ${preview.candidates.length}`)
      const res = await importListings(part)
      if (!res.ok) {
        setBusy(null)
        return void toast.error(`${res.error ?? GENERIC_ERROR} ${created + linked ? `(${created + linked} imported before that)` : ""}`.trim())
      }
      created += res.data.created
      linked += res.data.linked
    }
    setBusy(null)
    setPreview(null)
    toast.success(
      `Imported ${created} new item${created === 1 ? "" : "s"}${linked ? ` and linked ${linked} to items you had` : ""}.` +
        (created ? " Add what you paid under Inventory › Needs Cost." : ""),
    )
  }

  const canMercari = ext.supports("mercari") && extensionCanImport()
  const btn = "flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-bold disabled:opacity-60"

  return (
    <div className="flex flex-col gap-3 rounded-2xl border p-4">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold"><Download className="size-4" /> Import listings you already have</p>
        <p className="text-xs text-muted-foreground">
          Brings your live listings in as inventory, so FlipLedger can track and delist them. A listing whose title matches an item you already have is added to that item. Imported items don&apos;t know what you paid, so they&apos;re marked Needs Cost until you add it.
        </p>
      </div>

      {preview ? (
        <div className="flex flex-col gap-3 rounded-xl bg-muted/60 p-3">
          <p className="text-sm">
            Found <b>{preview.candidates.length}</b> live {NAMES[preview.source]} listing{preview.candidates.length === 1 ? "" : "s"}:
          </p>
          <ul className="list-disc pl-5 text-sm">
            <li>{preview.create} new inventory item{preview.create === 1 ? "" : "s"}</li>
            {preview.link > 0 && <li>{preview.link} added to items you already have</li>}
            {preview.skip > 0 && <li>{preview.skip} already in FlipLedger (skipped)</li>}
          </ul>
          <div className="flex gap-2">
            <button disabled={!!busy || preview.create + preview.link === 0} onClick={runImport} className={`${btn} flex-1 bg-brand text-ink`}>
              {busy && <Loader2 className="size-4 animate-spin" />} {busy ?? "Import"}
            </button>
            <button disabled={!!busy} onClick={() => setPreview(null)} className={`${btn} border bg-card`}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <TextInput
              value={closet} onChange={(e) => setCloset(e.target.value)}
              placeholder="Poshmark username or closet link" className="h-11" autoCapitalize="none" autoCorrect="off"
            />
            <button disabled={!!busy || !closet.trim()} onClick={findPoshmark} className={`${btn} bg-rose-800 text-white`}>
              Find
            </button>
          </div>
          <button disabled={!!busy || !canMercari} onClick={findMercari} className={`${btn} bg-red-500 text-white`}>
            Import from Mercari
          </button>
          <p className="text-xs text-muted-foreground">
            {canMercari
              ? "Mercari needs this computer: the extension reads your listings while you're logged in to Mercari in Chrome."
              : ext.info
                ? "Mercari import needs the newest FlipLedger extension. Update it in chrome://extensions."
                : <>Mercari import needs the <a href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer" className="font-semibold underline">FlipLedger Chrome extension</a> on a computer.</>}
          </p>
          {busy && <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> {busy}</p>}
        </>
      )}
    </div>
  )
}
