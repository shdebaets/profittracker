"use client"

// Talks to the FlipLedger Chrome extension (extension/ in this repo) through
// window.postMessage. The extension's content script on this site relays to it.
import { useEffect, useState } from "react"
import type { ImportCandidate } from "@/lib/import/plan"
import type { MarketplaceId } from "@/lib/marketplaces/registry"

/** Where sellers install the extension. */
export const EXTENSION_STORE_URL = "https://chromewebstore.google.com/detail/flipledger-lister/cagenhmfjlembnkfonjocdjjbdicimgp"

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
  const autoPublish = autoPublishEnabled() && extensionAtLeast(5)
  window.postMessage({ source: APP_SOURCE, type: "LIST", jobId, marketplace, listing, autoPublish }, location.origin)
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

// Per-computer switches for what the extension may do by itself. Off unless the seller turned them on.
function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === "1"
  } catch {
    return false
  }
}
function writeFlag(key: string, on: boolean) {
  try {
    if (on) localStorage.setItem(key, "1")
    else localStorage.removeItem(key)
  } catch {
    // Blocked storage: the setting just stays off.
  }
}

const AUTO_DELIST_KEY = "flipledger-auto-delist"
const AUTO_PUBLISH_KEY = "flipledger-auto-publish"

/** Whether this computer's extension may take listings down by itself. */
export const autoDelistEnabled = () => readFlag(AUTO_DELIST_KEY)
export const setAutoDelist = (on: boolean) => writeFlag(AUTO_DELIST_KEY, on)

/** Whether this computer's extension may click Publish after filling a listing in. */
export const autoPublishEnabled = () => readFlag(AUTO_PUBLISH_KEY)
export const setAutoPublish = (on: boolean) => writeFlag(AUTO_PUBLISH_KEY, on)

/** The installed extension is at least 0.minor.patch. */
function extensionAtLeast(minor: number, patch = 0) {
  const [major, mi, pa = 0] = (document.documentElement.getAttribute("data-flipledger-ext") ?? "0.0").split(".").map(Number)
  return major > 0 || mi > minor || (mi === minor && pa >= patch)
}

/** Older extensions don't know auto-delist and would open a normal tab for each listing. */
export const extensionCanAutoDelist = () => extensionAtLeast(3)

/** Importing Mercari listings arrived in extension 0.6.0. */
export const extensionCanImport = () => extensionAtLeast(6)

/**
 * Ask the extension to read the seller's live Mercari listings (it opens their listings
 * page in a background tab, then reads each listing). Needs them logged in to Mercari in Chrome.
 */
export function importWithExtension(marketplace: "mercari"): Promise<{ ok: true; candidates: ImportCandidate[] } | { ok: false; error: string }> {
  const jobId = crypto.randomUUID()
  return new Promise((resolve) => {
    const finish = (r: { ok: true; candidates: ImportCandidate[] } | { ok: false; error: string }) => {
      clearTimeout(timer)
      window.removeEventListener("message", onMsg)
      resolve(r)
    }
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== location.origin) return
      const d = e.data
      if (d?.source !== EXT_SOURCE || d.jobId !== jobId) return
      if (d.type === "IMPORTED") finish({ ok: true, candidates: Array.isArray(d.candidates) ? d.candidates : [] })
      else if (d.type === "ERROR") finish({ ok: false, error: d.error })
    }
    const timer = setTimeout(() => finish({ ok: false, error: "The extension took too long. Try again with Mercari open in Chrome." }), 5 * 60_000)
    window.addEventListener("message", onMsg)
    window.postMessage({ source: APP_SOURCE, type: "IMPORT", jobId, marketplace }, location.origin)
  })
}
