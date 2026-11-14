"use client"

import { ExternalLink, Wand2 } from "lucide-react"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { getAssistedOffers, logAssistedOffer } from "@/app/(app)/actions/offers"
import { extensionCanOffer, offerWithExtension, onExtensionResult, useExtension } from "@/lib/extension"
import { marketplace } from "@/lib/marketplaces/registry"
import { formatCents } from "@/lib/money"
import type { DueOffer } from "@/lib/offers-assisted"

/**
 * Smart Offers on Poshmark and Mercari. Their terms ban automated offers, so FlipLedger picks the
 * listings and the price, the extension fills the site's offer form, and the seller sends it.
 */
export function AssistedOffers({ enabled }: { enabled: boolean }) {
  const [offers, setOffers] = useState<DueOffer[] | null>(null)
  const [busy, start] = useTransition()
  const ext = useExtension()

  const load = () =>
    start(async () => {
      const res = await getAssistedOffers()
      if (res.ok) setOffers(res.offers)
      else toast.error(res.error)
    })
  useEffect(load, [enabled])

  // The extension reports back once the seller sent it on the site.
  useEffect(
    () =>
      onExtensionResult(async (r) => {
        if (r.type !== "OFFERED") return
        const res = await logAssistedOffer({ listingId: r.listingId, offerCents: r.offerCents })
        if (!res.ok) return void toast.error(res.error)
        toast.success(`Offer logged on ${marketplace(r.marketplace).short}`)
        setOffers((o) => o?.filter((x) => x.listingId !== r.listingId) ?? null)
      }),
    [],
  )

  const sentByHand = (o: DueOffer) =>
    start(async () => {
      const res = await logAssistedOffer({ listingId: o.listingId, offerCents: o.offerCents })
      if (!res.ok) return void toast.error(res.error)
      setOffers((x) => x?.filter((y) => y.listingId !== o.listingId) ?? null)
    })

  if (!enabled || !offers?.length) return null
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <p className="text-sm font-semibold">Due on Poshmark and Mercari</p>
      <p className="text-xs text-muted-foreground">
        Their rules don&apos;t allow automatic offers, so you send these. On a computer, the extension opens the listing and fills in the offer.
      </p>
      {offers.map((o) => {
        const m = marketplace(o.marketplace)
        const fill = ext.supports(o.marketplace) && extensionCanOffer() && !!o.url
        return (
          <div key={o.listingId} className="flex items-center gap-2 rounded-2xl bg-muted/60 p-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{o.title}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {m.short}: {formatCents(o.listPriceCents)} → {formatCents(o.offerCents)} ({o.pct}% off)
              </p>
            </div>
            {fill ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => offerWithExtension(o.marketplace, { listingId: o.listingId, itemId: o.itemId, url: o.url!, title: o.title, offerCents: o.offerCents })}
                className="flex h-9 shrink-0 items-center gap-1 rounded-xl bg-ink px-3 text-xs font-semibold text-white disabled:opacity-60"
              >
                <Wand2 className="size-3.5" /> Fill offer
              </button>
            ) : (
              <>
                {o.url && (
                  <a href={o.url} target="_blank" rel="noopener noreferrer" className="grid size-9 shrink-0 place-items-center rounded-xl border bg-card" aria-label={`Open on ${m.short}`}>
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
                <button type="button" disabled={busy} onClick={() => sentByHand(o)} className="h-9 shrink-0 rounded-xl border bg-card px-3 text-xs font-semibold disabled:opacity-60">
                  I sent it
                </button>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
