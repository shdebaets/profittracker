import { getExpenses, getItems, getSubscriptions } from "@/lib/data"
import { Dashboard } from "./dashboard"

export default async function DashboardPage() {
  const [items, expenses, subs] = await Promise.all([getItems(), getExpenses(), getSubscriptions()])
  return <Dashboard items={items} expenses={expenses} subs={subs} />
}
