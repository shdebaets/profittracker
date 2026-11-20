import Link from "next/link"
import { cn } from "@/lib/utils"

/** Selling (sales to ship) | Buying (online orders on their way in). */
export function OrdersSwitch({ view, buyingCount }: { view: "selling" | "buying"; buyingCount: number }) {
  const tab = (active: boolean) =>
    cn(
      "flex flex-1 items-center justify-center rounded-xl py-2 text-sm font-semibold transition",
      active ? "bg-foreground text-background shadow-sm" : "text-muted-foreground",
    )
  return (
    <nav aria-label="Orders" className="flex gap-1 rounded-2xl border bg-card p-1">
      <Link href="/orders" replace className={tab(view === "selling")} aria-current={view === "selling" ? "page" : undefined}>
        Selling
      </Link>
      <Link href="/orders?view=buying" replace className={tab(view === "buying")} aria-current={view === "buying" ? "page" : undefined}>
        Buying{buyingCount > 0 ? ` (${buyingCount})` : ""}
      </Link>
    </nav>
  )
}
