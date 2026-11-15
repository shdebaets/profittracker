import { redirect } from "next/navigation"
import { PageTitle } from "@/components/app-header"
import { getExpenses, getItems, getSettings, getSubscriptions } from "@/lib/data"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireUser } from "@/lib/supabase/server"
import { periodReport, taxSavings, yearPeriod } from "@/lib/tax"
import { billingState } from "@/lib/whop/billing"
import { whopConfig } from "@/lib/whop/config"
import { CancelFlow } from "./cancel-flow"

export default async function CancelPage() {
  const { userId } = await requireUser()
  const { data: link } = await createAdminClient()
    .from("whop_links")
    .select("whop_user_id")
    .eq("user_id", userId)
    .maybeSingle<{ whop_user_id: string }>()
  const billing = await billingState(link?.whop_user_id ?? null)
  if (!billing.linked || !billing.plan || billing.canceling || billing.paused) redirect("/crosslister")

  const [items, expenses, subs, settings] = await Promise.all([getItems(), getExpenses(), getSubscriptions(), getSettings()])
  const now = new Date()
  // Every tile is this calendar year, the same year as the tax savings.
  const period = yearPeriod(now.getFullYear())
  const year = periodReport(items, expenses, subs, period, now)
  const { savings } = taxSavings(year, settings.tax_bracket)
  const itemsThisYear = items.filter((i) => {
    const t = new Date(i.purchased_at)
    return t >= period.from && t < period.to
  }).length
  const liveListings = items.reduce((a, i) => a + i.listings.filter((l) => l.status === "active").length, 0)
  const { annualUrl, halfOffCodes } = whopConfig()

  return (
    <>
      <PageTitle title="Before you go" subtitle="Here's what FlipLedger is doing for you" />
      <CancelFlow
        stats={{
          savings,
          year: now.getFullYear(),
          miles: year.miles,
          expenseCents: year.expenseCents,
          items: itemsThisYear,
          liveListings,
        }}
        plan={billing.plan}
        renewsAt={billing.renewsAt}
        annualUrl={billing.plan === "monthly" ? annualUrl : ""}
        halfOff={halfOffCodes.length > 0}
      />
    </>
  )
}
