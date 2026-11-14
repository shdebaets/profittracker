import { CalendarCheck } from "lucide-react"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireUser } from "@/lib/supabase/server"
import { billingState, showYearlyBanner, yearlySeason } from "@/lib/whop/billing"
import { whopConfig } from "@/lib/whop/config"

/** Oct–Mar nudge for monthly Cross-Lister members to switch to the yearly plan. */
export function YearlyPlanBanner({ annualUrl }: { annualUrl: string }) {
  return (
    <a
      href={annualUrl}
      className="flex items-center gap-3 rounded-2xl border border-brand/40 bg-brand-soft px-4 py-3 text-sm shadow-sm"
    >
      <CalendarCheck className="size-5 shrink-0 text-brand" />
      <span className="min-w-0 flex-1">
        <b>Go yearly, get 2 months free.</b> $300 for the year instead of $360 month to month. Your monthly plan stops
        renewing on its own once you switch.
      </span>
      <span className="shrink-0 rounded-xl bg-brand px-3 py-2 font-bold text-ink">Switch</span>
    </a>
  )
}

/** Dashboard version: looks up the seller's plan itself (wrap it in Suspense; it waits on Whop). */
export async function DashboardYearlyBanner() {
  const { annualUrl } = whopConfig()
  const now = new Date()
  // Skip the Whop call entirely out of season or without a yearly checkout link.
  if (!annualUrl || !yearlySeason(now)) return null
  const { userId } = await requireUser()
  // whop_links is service-role only; scoped to this user.
  const { data: link } = await createAdminClient()
    .from("whop_links")
    .select("whop_user_id")
    .eq("user_id", userId)
    .maybeSingle<{ whop_user_id: string }>()
  if (!link) return null
  const billing = await billingState(link.whop_user_id)
  return showYearlyBanner(billing, annualUrl, now) ? <YearlyPlanBanner annualUrl={annualUrl} /> : null
}
