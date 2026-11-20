import { Suspense } from "react"
import { DashboardYearlyBanner } from "@/components/yearly-plan-banner"
import { countIncomingOnTheWay, getExpenses, getItems, getSettings, getSubscriptions } from "@/lib/data"
import { Dashboard } from "./dashboard"

export default async function DashboardPage() {
  const [items, expenses, subs, settings, onTheWay] = await Promise.all([getItems(), getExpenses(), getSubscriptions(), getSettings(), countIncomingOnTheWay()])
  return (
    <Dashboard
      items={items}
      expenses={expenses}
      subs={subs}
      settings={settings}
      onTheWay={onTheWay}
      // Streams in after the dashboard: it waits on Whop for the seller's plan.
      yearlyBanner={
        <Suspense fallback={null}>
          <DashboardYearlyBanner />
        </Suspense>
      }
    />
  )
}
