"use client"

import { Calculator, LayoutGrid, Plus, Receipt, ShoppingBag } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEntry } from "@/components/entry/entry-provider"
import { cn } from "@/lib/utils"

const TABS = [
  { href: "/", label: "Dashboard", icon: LayoutGrid },
  { href: "/calculator", label: "Calculator", icon: Calculator },
  null,
  { href: "/inventory", label: "Inventory", icon: ShoppingBag },
  { href: "/expenses", label: "Expenses", icon: Receipt },
] as const

export function BottomNav({ inventoryCount, expenseCount }: { inventoryCount: number; expenseCount: number }) {
  const pathname = usePathname()
  const { openEntry } = useEntry()
  const badges: Record<string, number> = { "/inventory": inventoryCount, "/expenses": expenseCount }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur pb-safe">
      <div className="mx-auto grid max-w-lg grid-cols-5 items-end px-2 pt-2 pb-2">
        {TABS.map((t) =>
          t === null ? (
            <div key="fab" className="flex flex-col items-center">
              <button
                onClick={() => openEntry("sold")}
                aria-label="Add entry"
                className="-mt-8 grid size-16 place-items-center rounded-full border-4 border-card bg-brand text-ink shadow-lg shadow-brand/40 transition active:scale-95"
              >
                <Plus className="size-8" strokeWidth={2.5} />
              </button>
              <span className="mt-0.5 text-xs font-semibold text-brand">Add</span>
            </div>
          ) : (
            <Link key={t.href} href={t.href} className="flex flex-col items-center gap-1">
              <span
                className={cn(
                  "relative grid size-11 place-items-center rounded-2xl transition",
                  (t.href === "/" ? pathname === "/" : pathname.startsWith(t.href))
                    ? "bg-brand text-ink"
                    : "text-muted-foreground",
                )}
              >
                <t.icon className="size-6" />
                {!!badges[t.href] && (
                  <span className="absolute -top-1.5 -right-2 min-w-5 rounded-full border-2 border-card bg-ink px-1 text-center font-mono text-[10px] leading-4 font-bold text-brand">
                    {badges[t.href] > 99 ? "99+" : badges[t.href]}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "text-xs font-semibold",
                  (t.href === "/" ? pathname === "/" : pathname.startsWith(t.href)) ? "text-brand" : "text-muted-foreground",
                )}
              >
                {t.label}
              </span>
            </Link>
          ),
        )}
      </div>
    </nav>
  )
}
