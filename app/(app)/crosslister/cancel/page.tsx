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
  const year = periodReport(items, expenses, subs, yearPeriod(now.getFullYear()), now)
  const { savings } = taxSavings(year, settings.tax_bracket)
  const miles = expenses.filter((e) => e.kind === "mileage").reduce((a, e) => a + Number(e.miles ?? 0), 0)
  const expenseCents = expenses.filter((e) => e.kind === "expense").reduce((a, e) => a + e.amount_cents, 0)
  const liveListings = items.reduce((a, i) => a + i.listings.filter((l) => l.status === "active").length, 0)
  const { annualUrl, savePromoCode } = whopConfig()

  return (
    <>
      <PageTitle title="Before you go" subtitle="Here's what FlipLedger is doing for you" />
      <CancelFlow
        stats={{
          savings,
          year: now.getFullYear(),
          miles: Math.round(miles * 10) / 10,
          expenseCents,
          items: items.length,
          liveListings,
        }}
        plan={billing.plan}
        renewsAt={billing.renewsAt}
        annualUrl={billing.plan === "monthly" ? annualUrl : ""}
        hasPromo={Boolean(savePromoCode)}
      />
    </>
  )
}
