"use client"

import { useEffect } from "react"
import { toast } from "sonner"
import { endListing, markAssistedListed } from "@/app/(app)/actions/crosslist"
import { markListingSynced } from "@/app/(app)/actions/edit"
import { logAssistedOffer } from "@/app/(app)/actions/offers"
import { onExtensionResult, pendingJobs } from "@/lib/extension"
import { marketplace } from "@/lib/marketplaces/registry"

/** Saves what the Chrome extension reports back (listing published, edited, ended, offer sent). */
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
        } else if (r.type === "EDITED") {
          const res = await markListingSynced(r.listingId)
          if (res.ok) toast.success(`Updated on ${name}`)
          else toast.error(res.error)
        } else if (r.type === "OFFERED") {
          // Logged here, on any page, so it counts even if the seller left Settings meanwhile.
          const res = await logAssistedOffer({ listingId: r.listingId, offerCents: r.offerCents })
          if (res.ok) toast.success(`Offer logged on ${name}`)
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
