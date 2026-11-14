import { notFound } from "next/navigation"
import { getExpenses, getItems, getSettings, getSubscriptions, getTaxForms } from "@/lib/data"
import { requireUser } from "@/lib/supabase/server"
import { ReportView } from "./report-view"

// A plain, printable page. "Save as PDF" from the print dialog gives the CPA a PDF.
// The report itself renders in the browser so years and dates follow the seller's time zone.
export default async function TaxReportPage({ params }: PageProps<"/tax-report/[year]">) {
  const year = Number((await params).year)
  if (!Number.isInteger(year) || year < 2000 || year > new Date().getFullYear() + 1) notFound()
  const [{ email }, items, expenses, subs, settings, forms] = await Promise.all([
    requireUser(), getItems(), getExpenses(), getSubscriptions(), getSettings(), getTaxForms(year),
  ])
  return <ReportView year={year} email={email ?? ""} items={items} expenses={expenses} subs={subs} settings={settings} forms={forms} />
}
