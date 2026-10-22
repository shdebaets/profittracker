"use client"

import { useEffect } from "react"
import { toast } from "sonner"
import { endListing, markAssistedListed } from "@/app/(app)/actions/crosslist"
import { onExtensionResult, pendingJobs } from "@/lib/extension"
import { marketplace } from "@/lib/marketplaces/registry"

/** Saves what the Chrome extension reports back (listing published, listing ended). */
export function ExtensionBridge() {
  useEffect(
    () =>
      onExtensionResult(async (r) => {
        if (r.type === "ERROR") return void toast.error(r.error)
        const name = marketplace(r.marketplace).short
        if (r.type === "LISTED") {
          const job = pendingJobs.get(r.jobId)
          pendingJobs.delete(r.jobId)
          const res = await markAssistedListed(r.itemId, {
            marketplace: r.marketplace,
            url: r.url ?? undefined,
            priceCents: job?.priceCents ?? null,
          })
          if (res.ok) toast.success(`Listed on ${name}`)
          else toast.error(res.error)
        } else {
          const res = await endListing(r.listingId, { manual: true })
          if (res.ok) toast.success(`Ended on ${name}`)
          else toast.error(res.error)
        }
      }),
    [],
  )
  return null
}
