"use client"

import { useSyncExternalStore } from "react"
import { formatCents } from "@/lib/money"
import {
  ISSUES_1099K, mileageLog, reconcile, scheduleC, TAX_DISCLAIMER, TAX_PLATFORM_LABELS, taxSavings, yearReport,
  type TaxPlatform,
} from "@/lib/tax"
import type { Expense, Item, Settings, Subscription } from "@/lib/types"
import { PrintButton } from "./print-button"

type Props = {
  year: number
  email: string
  items: Item[]
  expenses: Expense[]
  subs: Subscription[]
  settings: Settings
  forms: Partial<Record<TaxPlatform, number>>
}

const subscribe = () => () => {}

export function ReportView({ year, email, items, expenses, subs, settings, forms }: Props) {
  // Render only in the browser: year boundaries and the date depend on the seller's time zone.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false)
  if (!mounted) return <main className="p-8 text-sm text-gray-600">Loading report…</main>

  const report = yearReport(items, expenses, subs, year)
  const rows = reconcile(report, forms)
  const lines = scheduleC(report)
  const log = mileageLog(expenses, year)
  const { deductions, savings } = taxSavings(report, settings.tax_bracket)
  const nonForm = report.platforms.filter((p) => !ISSUES_1099K.includes(p.platform))

  return (
    <main className="mx-auto max-w-3xl bg-white p-8 text-[13px] text-black print:p-0">
      <style>{`@page { margin: 0.6in } body { background: white }`}</style>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">FlipLedger Tax Report {year}</h1>
          <p className="text-gray-600">{email} · Generated {new Date().toLocaleDateString("en-US")}</p>
        </div>
        <PrintButton />
      </div>
      <p className="mt-3 rounded border border-gray-300 bg-gray-50 px-3 py-2 text-xs">{TAX_DISCLAIMER}</p>

      <h2 className="mt-6 text-lg font-bold">Summary</h2>
      <Table
        rows={[
          ["Gross sales (incl. shipping buyers paid)", report.totals.gross],
          ["Sales", report.totals.sales, "count"],
          ["Cost of goods sold", report.totals.cogs],
          ["Marketplace fees", report.totals.fees],
          ["Shipping labels", report.totals.labels],
          [`Mileage (${report.miles} mi, ${report.trips} trips)`, report.mileageCents],
          ["Other expenses", report.expenseCents],
          ["Subscriptions", report.subscriptionCents],
          ["Net profit (estimate)", report.netProfit],
          [`Estimated tax savings from write-offs (${Math.round(settings.tax_bracket * 100)}% of ${formatCents(deductions)})`, savings],
        ]}
      />
      {report.unknownCostSales > 0 && (
        <p className="mt-1 text-xs text-gray-600">
          {report.unknownCostSales} sale(s) have no cost entered; COGS and profit for those count the cost as $0.
        </p>
      )}

      <h2 className="mt-6 text-lg font-bold">1099-K Reconciliation</h2>
      <table className="mt-2 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-black">
            {["Platform", "1099-K gross", "Logged gross", "Difference", "Fees", "Labels", "COGS", "Profit"].map((h) => (
              <th key={h} className="py-1 pr-2 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.platform} className="border-b border-gray-200">
              <td className="py-1 pr-2">{TAX_PLATFORM_LABELS[r.platform]}</td>
              <td className="pr-2 font-mono">{r.reportedEntered ? formatCents(r.reported) : "not entered"}</td>
              <td className="pr-2 font-mono">{formatCents(r.trackedGross)}</td>
              <td className="pr-2 font-mono">{r.reportedEntered ? formatCents(r.unexplained) : ""}</td>
              <td className="pr-2 font-mono">{formatCents(r.fees)}</td>
              <td className="pr-2 font-mono">{formatCents(r.labels)}</td>
              <td className="pr-2 font-mono">{formatCents(r.cogs)}</td>
              <td className="font-mono">{formatCents(r.net)}</td>
            </tr>
          ))}
          {nonForm.map((p) => (
            <tr key={p.platform} className="border-b border-gray-200 text-gray-600">
              <td className="py-1 pr-2">{TAX_PLATFORM_LABELS[p.platform]} (no 1099-K)</td>
              <td className="pr-2" />
              <td className="pr-2 font-mono">{formatCents(p.gross)}</td>
              <td className="pr-2" />
              <td className="pr-2 font-mono">{formatCents(p.fees)}</td>
              <td className="pr-2 font-mono">{formatCents(p.labels)}</td>
              <td className="pr-2 font-mono">{formatCents(p.cogs)}</td>
              <td className="font-mono">{formatCents(p.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-gray-600">
        A positive difference is usually sales tax the marketplace collected (not income) or sales not logged in FlipLedger.
        Poshmark can include cancelled sales.
      </p>

      <h2 className="mt-6 text-lg font-bold">Schedule C (Form 1040)</h2>
      <table className="mt-2 w-full border-collapse text-left">
        <tbody>
          {lines.map((l) => (
            <tr key={`${l.line}-${l.label}`} className="border-b border-gray-200">
              <td className="w-12 py-1 font-mono">{l.line}</td>
              <td>{l.label}</td>
              <td className="text-right font-mono">{formatCents(l.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-6 text-lg font-bold" style={{ breakBefore: "page" }}>Mileage Log</h2>
      <p className="text-xs text-gray-600">Business miles at the standard mileage rate. Locations are as logged (GPS trips show coordinates).</p>
      {log.length ? (
        <table className="mt-2 w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-black">
              {Object.keys(log[0]).map((h) => <th key={h} className="py-1 pr-2 font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {log.map((r, i) => (
              <tr key={i} className="border-b border-gray-200">
                {Object.values(r).map((v, j) => <td key={j} className="py-1 pr-2">{v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-2 text-gray-600">No trips logged for {year}.</p>
      )}
    </main>
  )
}

function Table({ rows }: { rows: [string, number, "count"?][] }) {
  return (
    <table className="mt-2 w-full border-collapse text-left">
      <tbody>
        {rows.map(([label, v, kind]) => (
          <tr key={label} className="border-b border-gray-200">
            <td className="py-1">{label}</td>
            <td className="text-right font-mono">{kind === "count" ? v : formatCents(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
