"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { toast } from "sonner"
import { syncSales } from "@/app/(app)/actions/crosslist"

const STALE_MS = 5 * 60_000

/** Pull new eBay sales when the app opens or comes back to the foreground (at most every 5 min). */
export function AutoSync() {
  const router = useRouter()
  useEffect(() => {
    let running = false
    async function tick() {
      if (running || document.visibilityState !== "visible") return
      running = true
      try {
        const res = await syncSales(STALE_MS)
        if (res.ok && res.data.sales) {
          toast.success(`${res.data.sales} new eBay sale${res.data.sales === 1 ? "" : "s"} synced`)
          router.refresh()
        }
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
