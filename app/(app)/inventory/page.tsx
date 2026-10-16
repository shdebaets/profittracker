import { getItems } from "@/lib/data"
import { requireUser } from "@/lib/supabase/server"
import { InventoryView } from "./inventory-view"

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const [items, params, { email }] = await Promise.all([getItems(), searchParams, requireUser()])
  return <InventoryView items={items} email={email} focusSearch={params.search === "1"} />
}
