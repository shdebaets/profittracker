import { PageTitle } from "@/components/app-header"
import type { CompStats } from "@/lib/comps/stats"
import { requireUser } from "@/lib/supabase/server"
import { CompView, type Tracked } from "./comp-view"

export default async function CompPage({ searchParams }: PageProps<"/comp">) {
  const [{ supabase }, params] = await Promise.all([requireUser(), searchParams])
  const { data } = await supabase.from("tracked_products").select("*").order("created_at", { ascending: false })
  const tracked = (data ?? []).map((t) => ({ ...t, stats: t.stats as CompStats | null })) as Tracked[]
  return (
    <>
      <PageTitle title="Scan to Comp" subtitle="Know what it sells for before you buy" />
      <CompView tracked={tracked} initialQuery={typeof params.q === "string" ? params.q : ""} />
    </>
  )
}
