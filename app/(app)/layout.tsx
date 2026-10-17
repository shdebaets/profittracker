import { AppHeader } from "@/components/app-header"
import { BottomNav } from "@/components/bottom-nav"
import { AutoSync } from "@/components/crosslist/auto-sync"
import { EntryProvider } from "@/components/entry/entry-provider"
import { requireUser } from "@/lib/supabase/server"
import { getSettings } from "@/lib/data"

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { supabase } = await requireUser()
  const [settings, inv, exp] = await Promise.all([
    getSettings(),
    supabase.from("items").select("id", { count: "exact", head: true }).eq("status", "inventory"),
    supabase.from("expenses").select("id", { count: "exact", head: true }),
  ])

  return (
    <EntryProvider defaultReturnDays={settings.default_return_days}>
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-5 px-4 pb-32">
        <AppHeader />
        {children}
      </div>
      <AutoSync />
      <BottomNav inventoryCount={inv.count ?? 0} expenseCount={exp.count ?? 0} />
    </EntryProvider>
  )
}
