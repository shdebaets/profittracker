import { PageTitle } from "@/components/app-header"
import { getExpenses, getItems } from "@/lib/data"
import { RecapView } from "./recap-view"

export default async function RecapPage() {
  const [items, expenses] = await Promise.all([getItems(), getExpenses()])
  return (
    <>
      <PageTitle title="Your week" subtitle="The last 7 days against the 7 before" />
      <RecapView items={items} expenses={expenses} />
    </>
  )
}
