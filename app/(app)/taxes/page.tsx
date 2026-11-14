import { PageTitle } from "@/components/app-header"
import { getExpenses, getItems, getSettings, getSubscriptions, getTaxForms } from "@/lib/data"
import { TaxesView } from "./taxes-view"

export default async function TaxesPage({ searchParams }: PageProps<"/taxes">) {
  const params = await searchParams
  const thisYear = new Date().getFullYear()
  const asked = Number(params.year)
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= thisYear ? asked : thisYear
  const [items, expenses, subs, settings, forms] = await Promise.all([
    getItems(), getExpenses(), getSubscriptions(), getSettings(), getTaxForms(year),
  ])
  return (
    <>
      <PageTitle title="Taxes" subtitle="1099-K check, Schedule C and quarterly estimates" />
      <TaxesView year={year} items={items} expenses={expenses} subs={subs} settings={settings} forms={forms} />
    </>
  )
}
