"use client"

// Talks to the FlipLedger Chrome extension (extension/ in this repo) through
// window.postMessage. The extension's content script on this site relays to it.
import { useEffect, useState } from "react"
import type { MarketplaceId } from "@/lib/marketplaces/registry"

const APP_SOURCE = "flipledger-app"
const EXT_SOURCE = "flipledger-ext"

export type ExtListing = {
  itemId: string
  title: string
  description: string
  priceCents: number | null
  condition: string | null
  brand: string
  size: string
  photoUrls: string[]
}

export type ExtResult =
  | { type: "LISTED"; jobId: string; marketplace: MarketplaceId; itemId: string; url: string | null }
  | { type: "DELISTED"; jobId: string; marketplace: MarketplaceId; listingId: string; itemId: string }
  | { type: "ERROR"; jobId?: string; marketplace?: MarketplaceId; error: string }

type ExtInfo = { version: string; marketplaces: MarketplaceId[] }

/** Jobs started from this tab, so a LISTED result can be saved with its price. */
export const pendingJobs = new Map<string, { priceCents: number | null }>()

/** The installed extension (version + supported marketplaces), or null. */
export function useExtension() {
  const [info, setInfo] = useState<ExtInfo | null>(null)
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== EXT_SOURCE || e.data.type !== "READY") return
      setInfo({ version: e.data.version, marketplaces: e.data.marketplaces ?? [] })
    }
    window.addEventListener("message", onMsg)
    // The content script may have announced itself before we mounted; ask again.
    window.postMessage({ source: APP_SOURCE, type: "PING" }, location.origin)
    return () => window.removeEventListener("message", onMsg)
  }, [])
  return {
    info,
    supports: (m: MarketplaceId) => !!info?.marketplaces.includes(m),
  }
}

export function listWithExtension(marketplace: MarketplaceId, listing: ExtListing) {
  const jobId = crypto.randomUUID()
  pendingJobs.set(jobId, { priceCents: listing.priceCents })
  window.postMessage({ source: APP_SOURCE, type: "LIST", jobId, marketplace, listing }, location.origin)
}

export function delistWithExtension(
  marketplace: MarketplaceId,
  job: { listingId: string; itemId: string; url: string | null; title: string },
) {
  window.postMessage({ source: APP_SOURCE, type: "DELIST", jobId: crypto.randomUUID(), marketplace, ...job }, location.origin)
}

export function onExtensionResult(handler: (r: ExtResult) => void) {
  const onMsg = (e: MessageEvent) => {
    if (e.source !== window || e.origin !== location.origin) return
    const d = e.data
    if (d?.source !== EXT_SOURCE || !["LISTED", "DELISTED", "ERROR"].includes(d.type)) return
    handler(d as ExtResult)
  }
  window.addEventListener("message", onMsg)
  return () => window.removeEventListener("message", onMsg)
}
