"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { toast } from "sonner"
import { applyExtensionSaleChecks, extensionDelistQueue, extensionWatchList, syncSales } from "@/app/(app)/actions/crosslist"
import { autoDelistEnabled, checkSalesWithExtension, delistWithExtension, extensionCanAutoDelist } from "@/lib/extension"
import { marketplace } from "@/lib/marketplaces/registry"

const STALE_MS = 5 * 60_000
let lastExtensionCheck = 0

/**
 * Have the Chrome extension check Mercari listing pages for sales (servers can't read them),
 * and Poshmark too, in case Poshmark ever blocks our server.
 * Returns how many listings changed (sales + confirmed delists); 0 without the extension.
 */
export async function checkExtensionSales(): Promise<number> {
  lastExtensionCheck = Date.now()
  const watch = await extensionWatchList()
  if (!watch.ok || !watch.data.length) return 0
  const checks = await checkSalesWithExtension(watch.data)
  if (!checks?.length) return 0
  const res = await applyExtensionSaleChecks(checks)
  if (!res.ok) {
    toast.error(res.error)
    return 0
  }
  for (const m of res.data.sales) toast.success(`New ${marketplace(m).label} sale recorded`)
  return res.data.sales.length + res.data.delisted
}

const AUTO_DELIST_BATCH = 3
const autoDelistTried = new Set<string>()

/**
 * If the seller opted in, have the extension take down waiting listings, a few at a time.
 * Each is tried once per page load: a failure stays on the delist list for the seller.
 */
async function runAutoDelist() {
  if (!autoDelistEnabled() || !extensionCanAutoDelist()) return
  const queue = await extensionDelistQueue()
  if (!queue.ok) return
  for (const { marketplace: m, ...job } of queue.data.filter((j) => !autoDelistTried.has(j.listingId)).slice(0, AUTO_DELIST_BATCH)) {
    autoDelistTried.add(job.listingId)
    delistWithExtension(m, { ...job, auto: true })
  }
}

/**
 * Pull new sales when the app opens or comes back to the foreground (at most every 5 min):
 * eBay and Poshmark on the server (so this works on phones), Mercari through the Chrome extension.
 */
export function AutoSync() {
  const router = useRouter()
  useEffect(() => {
    let running = false
    async function tick() {
      if (running || document.visibilityState !== "visible") return
      running = true
      try {
        const res = await syncSales(STALE_MS)
        if (res.ok) {
          const { sales, poshmark } = res.data
          if (sales) toast.success(`${sales} new eBay sale${sales === 1 ? "" : "s"} synced`)
          for (const m of poshmark.sales) toast.success(`New ${marketplace(m).label} sale recorded`)
          if (sales || poshmark.sales.length || poshmark.delisted) router.refresh()
        }
        if (Date.now() - lastExtensionCheck > STALE_MS && (await checkExtensionSales())) router.refresh()
        await runAutoDelist()
      } finally {
        running = false
      }
    }
    void tick()
    document.addEventListener("visibilitychange", tick)
    return () => document.removeEventListener("visibilitychange", tick)
  }, [router])
  return null
}
