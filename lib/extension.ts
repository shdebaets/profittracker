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
  job: { listingId: string; itemId: string; url: string | null; title: string; auto?: boolean },
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

export type ExtSaleCheck = { listingId: string; state: "sold" | "available" | "unavailable" | "unknown"; priceCents: number | null }

/**
 * Ask the extension to read each listing's public page and say whether it sold.
 * Resolves null when the extension isn't installed, is too old, or doesn't answer.
 */
export function checkSalesWithExtension(listings: { listingId: string; marketplace: string; url: string }[]): Promise<ExtSaleCheck[] | null> {
  if (!document.documentElement.hasAttribute("data-flipledger-ext")) return Promise.resolve(null)
  const jobId = crypto.randomUUID()
  return new Promise((resolve) => {
    const finish = (r: ExtSaleCheck[] | null) => {
      clearTimeout(timer)
      window.removeEventListener("message", onMsg)
      resolve(r)
    }
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== location.origin) return
      const d = e.data
      if (d?.source === EXT_SOURCE && d.type === "SALES" && d.jobId === jobId) finish(Array.isArray(d.results) ? d.results : null)
    }
    const timer = setTimeout(() => finish(null), 60_000)
    window.addEventListener("message", onMsg)
    window.postMessage({ source: APP_SOURCE, type: "CHECK_SALES", jobId, listings }, location.origin)
  })
}

const AUTO_DELIST_KEY = "flipledger-auto-delist"

/** Whether this computer's extension may take listings down by itself. Off unless the seller turned it on. */
export function autoDelistEnabled() {
  try {
    return localStorage.getItem(AUTO_DELIST_KEY) === "1"
  } catch {
    return false
  }
}

export function setAutoDelist(on: boolean) {
  try {
    if (on) localStorage.setItem(AUTO_DELIST_KEY, "1")
    else localStorage.removeItem(AUTO_DELIST_KEY)
  } catch {
    // Blocked storage: the setting just stays off.
  }
}

/** Older extensions don't know auto-delist and would open a normal tab for each listing. */
export function extensionCanAutoDelist() {
  const [major, minor] = (document.documentElement.getAttribute("data-flipledger-ext") ?? "0.0").split(".").map(Number)
  return major > 0 || minor >= 3
}
