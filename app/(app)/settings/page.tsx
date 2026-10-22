import { Cloud } from "lucide-react"
import { PageTitle } from "@/components/app-header"
import { getConnections, getSettings } from "@/lib/data"
import { ebayConfig } from "@/lib/marketplaces/ebay/client"
import { requireUser } from "@/lib/supabase/server"
import { MarketplacesSettings } from "./marketplaces"
import { SettingsForm } from "./settings-form"

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const [{ email }, settings, connections, params] = await Promise.all([
    requireUser(), getSettings(), getConnections(), searchParams,
  ])
  const cfg = ebayConfig()
  return (
    <>
      <PageTitle title="Settings" subtitle="Account, tax rates & preferences" />
      <p className="flex items-center gap-2 rounded-2xl border border-profit/30 bg-profit-soft px-4 py-3 text-sm">
        <Cloud className="size-4 shrink-0 text-profit" />
        <span className="truncate">Synced as <b>{email}</b> across devices</span>
        <span className="ml-auto size-2 shrink-0 rounded-full bg-profit" />
      </p>
      <SettingsForm settings={settings} />
      <MarketplacesSettings
        ebay={connections.find((c) => c.marketplace === "ebay") ?? null}
        configured={cfg.configured}
        sandbox={cfg.sandbox}
        policiesUrl={cfg.businessPoliciesUrl}
        connectStatus={typeof params.ebay === "string" ? params.ebay : undefined}
      />
      <div className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground">
        <p className="font-semibold text-foreground">Install on Your Phone</p>
        <p className="mt-1">
          iPhone: tap <b>Share</b> → <b>Add to Home Screen</b>. Android: tap the menu → <b>Install app</b>.
        </p>
      </div>
      <form action="/auth/signout" method="post">
        <button className="h-12 w-full rounded-2xl border bg-card font-semibold text-destructive">Sign out</button>
      </form>
    </>
  )
}
