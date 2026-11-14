import { PageTitle } from "@/components/app-header"
import { getExpenses, getItems } from "@/lib/data"
import { weekLabel, weeksEnding } from "@/lib/recap"
import { RecapView } from "./recap-view"

export default async function RecapPage({ searchParams }: PageProps<"/recap">) {
  const [items, expenses, { week }] = await Promise.all([getItems(), getExpenses(), searchParams])
  // ?week=YYYY-MM-DD is the week a Sunday email or push described; without it, the last 7 days.
  const key = typeof week === "string" && weeksEnding(week) ? week : null
  return (
    <>
      <PageTitle
        title="Your week"
        subtitle={key ? `${weekLabel(weeksEnding(key)!.week)} against the week before` : "The last 7 days against the 7 before"}
      />
      <RecapView items={items} expenses={expenses} weekKey={key} />
    </>
  )
}
