import { marketplace } from "@/lib/marketplaces/registry"
import type { Listing } from "@/lib/types"
import { cn } from "@/lib/utils"

const STATUS_HINT: Partial<Record<Listing["status"], string>> = {
  delist_pending: "needs delisting",
  error: "couldn't end",
  sold: "sold",
  delisted: "ended",
}

/** Small marketplace pills. Live listings are solid; ended ones are muted (only with showEnded). */
export function ListingBadges({ listings, showEnded = false }: { listings: Listing[]; showEnded?: boolean }) {
  const shown = listings.filter((l) => showEnded || l.status !== "delisted")
  if (!shown.length) return null
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((l) => {
        const m = marketplace(l.marketplace)
        const live = l.status === "active"
        const hint = STATUS_HINT[l.status]
        return (
          <span
            key={l.id}
            title={hint ? `${m.label}: ${hint}` : m.label}
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[11px] font-bold",
              live
                ? m.badge
                : l.status === "delist_pending" || l.status === "error"
                  ? "bg-loss/15 text-loss"
                  : l.status === "sold"
                    ? "bg-profit-soft text-profit"
                    : "bg-muted text-muted-foreground line-through",
            )}
          >
            {m.short}
            {(l.status === "delist_pending" || l.status === "error") && " !"}
          </span>
        )
      })}
    </span>
  )
}
