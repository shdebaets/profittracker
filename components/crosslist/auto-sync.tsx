"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { toast } from "sonner"
import { applyExtensionSaleChecks, extensionWatchList, syncSales } from "@/app/(app)/actions/crosslist"
import { checkSalesWithExtension } from "@/lib/extension"
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
