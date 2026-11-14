import { getItems, getSettings } from "@/lib/data"
import { requireUser } from "@/lib/supabase/server"
import { InventoryView, type Chip } from "./inventory-view"

const CHIPS: Chip[] = ["returns", "unlisted", "cost", "stale"]

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const [items, params, { email }, settings] = await Promise.all([getItems(), searchParams, requireUser(), getSettings()])
  const filter = typeof params.filter === "string" ? params.filter : ""
  return (
    <InventoryView
      items={items}
      email={email}
      focusSearch={params.search === "1"}
      initialChip={CHIPS.includes(filter as Chip) ? (filter as Chip) : "all"}
      staleDays={settings.stale_days}
    />
  )
}
