"use client"

import { History, Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { knownSoldIds, startSoldMatch, uploadSoldRows } from "@/app/(app)/actions/research"
import { extensionCanPullSold, pullSoldWithExtension, useExtension, type SoldProgress } from "@/lib/extension"
import { stampET } from "@/lib/research/days"
import type { ResearchRun } from "@/lib/research/types"

const STALE_MS = 12 * 3600_000
const BATCH = 800

/**
 * Sold history comes from eBay's sold search pages, read by the FlipLedger extension in
 * the seller's own Chrome. It's shared: one pull updates the item for everyone.
 * Opening an item with missing or 12-hour-old sold data pulls it automatically.
 */
export function SoldHistory({
  productId, keywords, collected, collectedAt, run,
}: {
  productId: string
  keywords: string[]
  collected: boolean
  collectedAt: string | null
  run: ResearchRun | null
}) {
  const router = useRouter()
  const { info } = useExtension()
  const [progress, setProgress] = useState<SoldProgress | null>(null)
  const [busy, setBusy] = useState<"pulling" | "saving" | null>(null)
  const started = useRef(false)
  const canPull = !!info && extensionCanPullSold()
  const matching = run?.status === "running"

  const pull = useCallback(async (auto: boolean) => {
    if (busy) return
    setBusy("pulling")
    try {
      const refresh = collected
      const known = refresh ? await knownSoldIds(productId) : []
      const r = await pullSoldWithExtension(keywords, { refresh, knownIds: known }, setProgress)
      if (!r.ok) {
        if (!auto) toast.error(r.error)
        else toast.message("Sold history wasn't updated", { description: r.error })
        return
      }
      setBusy("saving")
      for (let i = 0; i < r.rows.length; i += BATCH) {
        const saved = await uploadSoldRows(productId, r.rows.slice(i, i + BATCH))
        if (!saved.ok) throw new Error(saved.error)
      }
      const started = await startSoldMatch(productId)
      if (!started.ok) throw new Error(started.error)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save sold history")
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }, [busy, collected, keywords, productId, router])

  // Automatic pull: once per item per session, when the data is missing or stale.
  useEffect(() => {
    const stale = !collectedAt || Date.now() - Date.parse(collectedAt) > STALE_MS
    if (!canPull || !stale || matching || started.current) return
    const key = `flipledger-sold-pull:${productId}`
    try {
      const last = Number(sessionStorage.getItem(key) ?? 0)
      if (Date.now() - last < STALE_MS) return
      sessionStorage.setItem(key, String(Date.now()))
    } catch {
      // Storage blocked: still pull once for this page view.
    }
    started.current = true
    // Deferred (not cancelled on cleanup) so a dev-mode double mount still pulls exactly once.
    setTimeout(() => void pull(true), 0)
  }, [canPull, collectedAt, matching, productId, pull])

  const status = busy === "pulling"
    ? progress
      ? `Reading eBay sold results · search ${progress.keyword}/${progress.keywords} · page ${progress.page} · ${progress.count.toLocaleString()} found`
      : "Opening eBay in a background tab…"
    : busy === "saving"
      ? "Saving sold results…"
      : matching
        ? `Matching sold results · ${run?.progress?.judged ?? 0}/${run?.progress?.pulled ?? "?"} checked`
        : null

  return (
    <section className="flex flex-col gap-2 rounded-3xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-bold">
          <History className="size-4" /> Sold history
        </h2>
        {canPull && (
          <button onClick={() => void pull(false)} disabled={!!busy || matching} className="text-sm font-semibold text-blue-600 disabled:opacity-50">
            {collected ? "Update now" : "Pull now"}
          </button>
        )}
      </div>
      {status ? (
        <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> {status}</p>
      ) : collectedAt ? (
        <p className="text-sm text-muted-foreground">
          Updated {stampET(collectedAt)}
          {run?.status === "error" && run.error ? ` · ${run.error}` : ""}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Not pulled yet. Units sold and sold prices fill in once it is.</p>
      )}
      {!canPull && (
        <p className="text-sm text-muted-foreground">
          {info
            ? "Update the FlipLedger extension to 0.7 or later to read eBay sold prices."
            : "Sold prices are read from eBay by the FlipLedger extension in Chrome on a computer. Open this item there and it updates for everyone tracking it."}{" "}
          <Link href="/extension" className="font-semibold text-blue-600">Get the extension</Link>
        </p>
      )}
    </section>
  )
}
