import { Cloud } from "lucide-react"
import { PageTitle } from "@/components/app-header"
import { getConnections, getSettings } from "@/lib/data"
import { ebayConfig } from "@/lib/marketplaces/ebay/client"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireUser } from "@/lib/supabase/server"
import { MANAGE_BILLING_URL } from "@/lib/whop/config"
import { MarketplacesSettings } from "./marketplaces"
import { SettingsForm } from "./settings-form"

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const [{ email, userId }, settings, connections, params] = await Promise.all([
    requireUser(), getSettings(), getConnections(), searchParams,
  ])
  // whop_links is service-role only; scoped to this user.
  const { data: whop } = await createAdminClient()
    .from("whop_links")
    .select("whop_username")
    .eq("user_id", userId)
    .maybeSingle<{ whop_username: string | null }>()
  const cfg = ebayConfig()
  return (
    <>
      <PageTitle title="Settings" subtitle="Account, tax rates & preferences" />
      <p className="flex items-center gap-2 rounded-2xl border border-profit/30 bg-profit-soft px-4 py-3 text-sm">
        <Cloud className="size-4 shrink-0 text-profit" />
        <span className="truncate">
          {whop?.whop_username ? <>Signed in with Whop as <b>@{whop.whop_username}</b></> : <>Synced as <b>{email}</b> across devices</>}
        </span>
        <span className="ml-auto size-2 shrink-0 rounded-full bg-profit" />
      </p>
      {whop && (
        <a
          href={MANAGE_BILLING_URL}
          target="_blank"
          rel="noreferrer"
          className="rounded-3xl border bg-card p-5 text-sm"
        >
          <span className="font-semibold">Membership</span>
          <span className="mt-1 block text-muted-foreground">Update your payment method or cancel on Whop →</span>
        </a>
      )}
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
