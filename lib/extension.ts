"use client"

// Talks to the FlipLedger Chrome extension (extension/ in this repo) through
// window.postMessage. The extension's content script on this site relays to it.
import { useEffect, useState } from "react"
import type { ImportCandidate } from "@/lib/import/plan"
import type { MarketplaceId } from "@/lib/marketplaces/registry"
import type { MarketplaceSale } from "@/lib/sales/untracked"

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

/** Reading the seller's Mercari sold lists arrived in extension 0.7.0. */
export const extensionCanImportSales = () => extensionAtLeast(7)

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

/**
 * Ask the extension to read the seller's Mercari sold lists (a tab opens on them, collects
 * the sold items, then each item's page is read). Only reads; it doesn't click anything.
 */
export function importSalesWithExtension(marketplace: "mercari"): Promise<{ ok: true; sales: MarketplaceSale[] } | { ok: false; error: string }> {
  const jobId = crypto.randomUUID()
  return new Promise((resolve) => {
    const finish = (r: { ok: true; sales: MarketplaceSale[] } | { ok: false; error: string }) => {
      clearTimeout(timer)
      window.removeEventListener("message", onMsg)
      resolve(r)
    }
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== location.origin) return
      const d = e.data
      if (d?.source !== EXT_SOURCE || d.jobId !== jobId) return
      if (d.type === "SOLD_ITEMS") finish({ ok: true, sales: Array.isArray(d.sales) ? d.sales : [] })
      else if (d.type === "ERROR") finish({ ok: false, error: d.error })
    }
    const timer = setTimeout(() => finish({ ok: false, error: "The extension took too long. Try again with Mercari open in Chrome." }), 5 * 60_000)
    window.addEventListener("message", onMsg)
    window.postMessage({ source: APP_SOURCE, type: "IMPORT_SALES", jobId, marketplace }, location.origin)
  })
}

// ---------- Poshmark Assistant (extension 0.8.0+) ----------
// Opt-in jobs the extension runs in the seller's own logged-in Poshmark tab: share the closet,
// share to the live party, Offer to Likers. Settings are per computer, like the switches above.
// The extension enforces the safety rules itself (random waits, daily caps, stop on pushback).

export type PoshTask = "SHARE_CLOSET" | "SHARE_PARTY" | "OFFER_LIKERS"
export type PoshSettings = {
  username: string
  shareCloset: boolean
  shareParty: boolean
  offerLikers: boolean
  /** Percent off the listing price for Offer to Likers (Poshmark needs at least 10). */
  offerPercent: number
  /** Never offer under this, in cents. */
  floorCents: number
  /** Daily caps; the extension never goes over 300 shares or 50 offers whatever these say. */
  shareCap: number
  offerCap: number
}
export type PoshSummary = { shared: number; offered: number; skipped: number; note?: string }
export type PoshEvent =
  | { type: "POSH_PROGRESS"; kind: string; text: string; summary: PoshSummary }
  | { type: "POSH_DONE"; kind: string; summary: PoshSummary; last: boolean }
  | { type: "ERROR"; kind?: string; error: string; summary?: PoshSummary }

export const POSH_MAX_SHARES = 300
export const POSH_MAX_OFFERS = 50
export const POSH_DEFAULTS: PoshSettings = {
  username: "",
  shareCloset: false,
  shareParty: false,
  offerLikers: false,
  offerPercent: 10,
  floorCents: 0,
  shareCap: POSH_MAX_SHARES,
  offerCap: POSH_MAX_OFFERS,
}

const POSH_KEY = "flipledger-posh-assistant"

function readJson(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Blocked storage: the settings just don't stick.
  }
}

/** The raw stored settings (a string, so React can compare snapshots). */
export const poshSettingsRaw = () => readJson(POSH_KEY)

/** Stored settings over the defaults; anything malformed falls back to the default (all off). */
export function parsePoshSettings(raw: string | null): PoshSettings {
  let v: Partial<Record<keyof PoshSettings, unknown>> = {}
  try {
    v = raw ? JSON.parse(raw) : {}
  } catch {
    // Keep the defaults.
  }
  const num = (x: unknown, min: number, max: number, d: number) =>
    typeof x === "number" && Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x))) : d
  return {
    username: typeof v.username === "string" ? v.username : "",
    shareCloset: v.shareCloset === true,
    shareParty: v.shareParty === true,
    offerLikers: v.offerLikers === true,
    offerPercent: num(v.offerPercent, 10, 80, POSH_DEFAULTS.offerPercent),
    floorCents: num(v.floorCents, 0, 10_000_00, 0),
    shareCap: num(v.shareCap, 0, POSH_MAX_SHARES, POSH_MAX_SHARES),
    offerCap: num(v.offerCap, 0, POSH_MAX_OFFERS, POSH_MAX_OFFERS),
  }
}
export const setPoshSettings = (s: PoshSettings) => writeJson(POSH_KEY, s)

/** A Poshmark username as typed ("@name", a closet link) → "name", or "" if it isn't one. Same rule as the extension's FL.posh.username. */
export function poshUsername(input: string) {
  const s = input.trim().replace(/^https?:\/\/(www\.)?poshmark\.com\/closet\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "")
  return /^[A-Za-z0-9_.-]{1,40}$/.test(s) ? s : ""
}

/** The Poshmark Assistant arrived in extension 0.8.0. */
export const extensionCanPoshAssist = () => extensionAtLeast(8)

/** The jobs Run now does, in order, from the switches the seller turned on. */
export function poshTasks(s: PoshSettings): PoshTask[] {
  return [
    ...(s.shareCloset ? (["SHARE_CLOSET"] as const) : []),
    ...(s.shareParty ? (["SHARE_PARTY"] as const) : []),
    ...(s.offerLikers ? (["OFFER_LIKERS"] as const) : []),
  ]
}

/**
 * Start the Poshmark Assistant: the extension opens the seller's closet in a new tab and runs
 * `tasks` one after another there. `onEvent` gets progress and results; the returned function
 * stops listening. The run ends with a POSH_DONE whose `last` is true, or an ERROR.
 */
export function runPoshAssistant(tasks: PoshTask[], s: PoshSettings, onEvent: (e: PoshEvent) => void) {
  const jobId = crypto.randomUUID()
  const onMsg = (e: MessageEvent) => {
    if (e.source !== window || e.origin !== location.origin) return
    const d = e.data
    if (d?.source !== EXT_SOURCE || d.jobId !== jobId || !["POSH_PROGRESS", "POSH_DONE", "ERROR"].includes(d.type)) return
    onEvent(d as PoshEvent)
  }
  window.addEventListener("message", onMsg)
  const [first, ...then] = tasks
  window.postMessage(
    {
      source: APP_SOURCE,
      type: first,
      jobId,
      marketplace: "poshmark",
      username: s.username,
      options: { percent: s.offerPercent, floorCents: s.floorCents },
      caps: { shares: s.shareCap, offers: s.offerCap },
      then,
    },
    location.origin,
  )
  return () => window.removeEventListener("message", onMsg)
}
