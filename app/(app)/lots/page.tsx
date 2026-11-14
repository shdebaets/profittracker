import { PageTitle } from "@/components/app-header"
import { getHauls, getItems } from "@/lib/data"
import { signPaths } from "@/lib/photos"
import { requireUser } from "@/lib/supabase/server"
import { LotsView } from "./lots-view"

export default async function LotsPage() {
  const [{ supabase }, hauls, items] = await Promise.all([requireUser(), getHauls(), getItems()])
  const urls = await signPaths(supabase, hauls.flatMap((h) => (h.receipt_path ? [h.receipt_path] : [])))
  return (
    <>
      <PageTitle title="Lots" subtitle="What each lot cost and what it's brought back" />
      <LotsView hauls={hauls.map((h) => ({ ...h, receipt_url: h.receipt_path ? urls.get(h.receipt_path) ?? null : null }))} items={items} />
    </>
  )
}
