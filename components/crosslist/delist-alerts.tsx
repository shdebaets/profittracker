"use client"

import { AlertTriangle, Check, ExternalLink } from "lucide-react"
import { useTransition } from "react"
import { toast } from "sonner"
import { endListing } from "@/app/(app)/actions/crosslist"
import { marketplace } from "@/lib/marketplaces/registry"
import type { Item } from "@/lib/types"
import { cn } from "@/lib/utils"

/** To-do list of listings that must come down because the item sold elsewhere. */
export function DelistAlerts({ items }: { items: Item[] }) {
  const todo = items.flatMap((i) =>
    i.listings.filter((l) => l.status === "delist_pending" || l.status === "error").map((l) => ({ item: i, l })),
  )
  const [pending, start] = useTransition()
  if (!todo.length) return null

  return (
    <section className="rounded-3xl border border-loss/40 bg-loss/5 p-4">
      <p className="flex items-center gap-2 font-bold text-loss">
        <AlertTriangle className="size-5" /> Delist {todo.length === 1 ? "this listing" : `these ${todo.length} listings`}
      </p>
      <p className="mt-0.5 text-sm text-muted-foreground">Sold elsewhere. Take these down so you don&apos;t sell it twice.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {todo.map(({ item, l }) => {
          const m = marketplace(l.marketplace)
          return (
            <li key={l.id} className="flex items-center gap-2 rounded-2xl border bg-card p-2 pl-3">
              <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold", m.badge)}>{m.short}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{item.title || `Item #${item.seq}`}</span>
                {l.status === "error" && <span className="block truncate text-xs text-loss">{l.last_error}</span>}
              </span>
              <a
                href={l.external_url ?? m.manageUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${m.label}`}
                className="grid size-9 shrink-0 place-items-center rounded-xl border"
              >
                <ExternalLink className="size-4" />
              </a>
              <button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await endListing(l.id)
                    if (res.ok) return void toast.success(m.mode === "api" ? "Listing ended" : "Marked delisted")
                    toast.error(res.error, {
                      duration: 10000,
                      action: {
                        label: "I ended it",
                        onClick: () => start(async () => void (await endListing(l.id, { manual: true }))),
                      },
                    })
                  })
                }
                className="flex h-9 shrink-0 items-center gap-1 rounded-xl bg-ink px-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                <Check className="size-4" /> {m.mode === "api" ? "Retry" : "Done"}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
