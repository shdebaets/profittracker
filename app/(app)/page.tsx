import { countIncomingOnTheWay, getExpenses, getItems, getSettings, getSubscriptions } from "@/lib/data"
import { Dashboard } from "./dashboard"

export default async function DashboardPage() {
  const [items, expenses, subs, settings, onTheWay] = await Promise.all([getItems(), getExpenses(), getSubscriptions(), getSettings(), countIncomingOnTheWay()])
  return <Dashboard items={items} expenses={expenses} subs={subs} settings={settings} onTheWay={onTheWay} />
}
