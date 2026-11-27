import { countIncomingOnTheWay, getConnections, getExpenses, getItems, getSettings, getSubscriptions } from "@/lib/data"
import { Dashboard } from "./dashboard"

export default async function DashboardPage() {
  const [items, expenses, subs, settings, onTheWay, connections] = await Promise.all([
    getItems(), getExpenses(), getSubscriptions(), getSettings(), countIncomingOnTheWay(), getConnections(),
  ])
  const ebayExpired = connections.find((c) => c.marketplace === "ebay")?.reconnect_needed_at ?? null
  return <Dashboard items={items} expenses={expenses} subs={subs} settings={settings} onTheWay={onTheWay} ebayExpired={ebayExpired} />
}
