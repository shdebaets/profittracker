import { PageTitle } from "@/components/app-header"
import { requireUser } from "@/lib/supabase/server"
import { getCancelledSales, getExpenses, getItems, getSettings, getSubscriptions, getTaxForms } from "@/lib/data"
import { TaxesView } from "./taxes-view"

export default async function TaxesPage({ searchParams }: PageProps<"/taxes">) {
  const params = await searchParams
  const thisYear = new Date().getFullYear()
  const asked = Number(params.year)
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= thisYear ? asked : thisYear
  const [{ email }, items, expenses, subs, settings, forms, cancelled] = await Promise.all([
    requireUser(), getItems(), getExpenses(), getSubscriptions(), getSettings(), getTaxForms(year), getCancelledSales(),
  ])
  return (
    <>
      <PageTitle title="Taxes" subtitle="1099-K check, Schedule C and quarterly estimates" />
      <TaxesView year={year} items={items} expenses={expenses} subs={subs} settings={settings} forms={forms} cancelled={cancelled} email={email ?? ""} />
    </>
  )
}
