import { getExpenses, getSettings, getSubscriptions } from "@/lib/data"
import { ExpensesView } from "./expenses-view"

export default async function ExpensesPage() {
  const [expenses, subs, settings] = await Promise.all([getExpenses(), getSubscriptions(), getSettings()])
  return <ExpensesView expenses={expenses} subs={subs} rateCents={settings.mileage_rate_cents} />
}
