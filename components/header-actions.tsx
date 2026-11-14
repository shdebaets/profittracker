"use client"

import { PackagePlus, Search, Settings, Truck } from "lucide-react"
import Link from "next/link"
import { useEntry } from "@/components/entry/entry-provider"

const btn = "grid size-10 sm:size-11 place-items-center rounded-2xl border bg-card shadow-sm transition active:scale-95"

export function HeaderActions() {
  const { openEntry } = useEntry()
  return (
    <div className="flex gap-1.5 sm:gap-2">
      <Link href="/inventory?search=1" aria-label="Search items" className={btn}>
        <Search className="size-5 text-brand" />
      </Link>
      <button onClick={() => openEntry("inventory")} aria-label="Add inventory" className={btn}>
        <PackagePlus className="size-5 text-brand" />
      </button>
      <Link href="/orders" aria-label="Orders" className={btn}>
        <Truck className="size-5 text-brand" />
      </Link>
      <Link href="/settings" aria-label="Settings" className={btn}>
        <Settings className="size-5" />
      </Link>
    </div>
  )
}
