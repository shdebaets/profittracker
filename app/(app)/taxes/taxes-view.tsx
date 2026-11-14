"use client"

import { Car, Download, FileText, Info, PiggyBank, Printer } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { saveTaxForm } from "@/app/(app)/actions/expenses"
import { MoneyInput, NativeSelect } from "@/components/fields"
import { exportCsv } from "@/lib/csv"
import { centsToInput, formatCents, toCents } from "@/lib/money"
import {
  estimatedTax, irsQuarters, ISSUES_1099K, mileageLog, periodReport, reconcile, scheduleC,
  TAX_DISCLAIMER, TAX_PLATFORM_LABELS, taxSavings, yearReport, type ReconcileRow, type TaxPlatform,
} from "@/lib/tax"
import type { Expense, Item, Settings, Subscription } from "@/lib/types"
import { cn } from "@/lib/utils"

type Props = {
  year: number
  items: Item[]
  expenses: Expense[]
  subs: Subscription[]
  settings: Settings
  forms: Partial<Record<TaxPlatform, number>>
}

const usd = (c: number) => (c / 100).toFixed(2)

export function TaxesView({ year, items, expenses, subs, settings, forms }: Props) {
  const router = useRouter()
  const now = new Date()
  const report = yearReport(items, expenses, subs, year, now)
  const rows = reconcile(report, forms)
  const lines = scheduleC(report)
  const { savings, deductions } = taxSavings(report, settings.tax_bracket)
  const reportedTotal = rows.reduce((a, r) => a + r.reported, 0)
  const nonFormGross = report.platforms.filter((p) => !ISSUES_1099K.includes(p.platform)).reduce((a, p) => a + p.gross, 0)
  const years = Array.from({ length: 4 }, (_, i) => now.getFullYear() - i)

  return (
    <>
      <div className="flex items-center gap-3">
        <NativeSelect value={String(year)} onChange={(e) => router.push(`/taxes?year=${e.target.value}`)} className="w-32">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </NativeSelect>
        <p className="text-sm text-muted-foreground">Tax year</p>
      </div>

      <p className="flex gap-2 rounded-2xl bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
        <Info className="size-4 shrink-0" /> {TAX_DISCLAIMER}
      </p>

      {/* Savings */}
      <section className="rounded-3xl border border-profit/30 bg-gradient-to-br from-profit-soft to-card p-5 shadow-sm">
        <p className="flex items-center gap-2 text-xs font-bold tracking-wider text-muted-foreground uppercase">
          <PiggyBank className="size-4 text-profit" /> Tax savings {year}
        </p>
        <p className="mt-2 font-mono text-[2.4rem] leading-none font-extrabold tracking-tighter text-profit">{formatCents(savings)}</p>
        <div className="mt-4 grid grid-cols-2 gap-y-2 border-t pt-3 font-mono text-xs text-muted-foreground">
          <span>Cost of goods sold</span><span className="text-right text-foreground">{formatCents(report.totals.cogs)}</span>
          <span>Mileage ({report.miles} mi)</span><span className="text-right text-foreground">{formatCents(report.mileageCents)}</span>
          <span>Expenses</span><span className="text-right text-foreground">{formatCents(report.expenseCents)}</span>
          <span>Subscriptions</span><span className="text-right text-foreground">{formatCents(report.subscriptionCents)}</span>
          <span className="font-semibold">Write-offs</span><span className="text-right font-semibold text-foreground">{formatCents(deductions)}</span>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Write-offs × your {Math.round(settings.tax_bracket * 100)}% bracket.{" "}
          <Link href="/settings" className="font-semibold text-brand">Change bracket</Link>
        </p>
      </section>

      {/* 1099-K */}
      <section className="flex flex-col gap-4 rounded-3xl border bg-card p-5 shadow-sm">
        <div>
          <h2 className="text-lg font-bold">1099-K Reconciler</h2>
          <p className="text-sm text-muted-foreground">
            Marketplaces report gross sales, including shipping and sales tax the buyer paid. That isn&apos;t your income.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-muted/60 p-3">
            <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">What the IRS sees</p>
            <p className="mt-1 font-mono text-xl font-bold">{formatCents(reportedTotal)}</p>
            <p className="text-xs text-muted-foreground">1099-K gross</p>
          </div>
          <div className="rounded-2xl bg-profit-soft p-3">
            <p className="text-xs font-bold tracking-wide text-profit uppercase">What you made</p>
            <p className={cn("mt-1 font-mono text-xl font-bold", report.netProfit < 0 ? "text-loss" : "text-profit")}>
              {formatCents(report.netProfit)}
            </p>
            <p className="text-xs text-muted-foreground">Net profit, all sales</p>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No marketplace sales logged for {year} yet.</p>
        ) : (
          rows.map((r) => <PlatformRow key={r.platform} row={r} year={year} />)
        )}
        {nonFormGross > 0 && (
          <p className="text-xs text-muted-foreground">
            Plus {formatCents(nonFormGross)} in cash, local and other sales. No 1099-K for those, but they&apos;re still income.
          </p>
        )}
        {report.unknownCostSales > 0 && (
          <Link href="/inventory?filter=cost" className="text-sm font-semibold text-brand">
            {report.unknownCostSales} sale{report.unknownCostSales === 1 ? " has" : "s have"} no cost entered, so your COGS is too low. Add costs →
          </Link>
        )}
        <p className="text-xs text-muted-foreground">
          Poshmark can count cancelled sales on your 1099-K. If yours is higher than what&apos;s logged here, that&apos;s a common reason.
        </p>
      </section>

      <Quarterly items={items} expenses={expenses} subs={subs} settings={settings} year={year} />

      {/* Schedule C */}
      <section className="flex flex-col gap-3 rounded-3xl border bg-card p-5 shadow-sm">
        <div>
          <h2 className="text-lg font-bold">Schedule C Summary</h2>
          <p className="text-sm text-muted-foreground">Mapped to Schedule C lines. Hand this to your CPA.</p>
        </div>
        <div className="divide-y rounded-2xl border">
          {lines.map((l) => (
            <div
              key={`${l.line}-${l.label}`}
              className={cn("flex items-center gap-3 px-3 py-2.5 text-sm", ["7", "28", "31"].includes(l.line) && "bg-muted/50 font-semibold")}
            >
              <span className="w-9 shrink-0 font-mono text-xs text-muted-foreground">{l.line}</span>
              <span className="min-w-0 flex-1">{l.label}</span>
              <span className="shrink-0 font-mono">{formatCents(l.cents)}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Link
            href={`/tax-report/${year}`}
            target="_blank"
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-ink font-bold text-white"
          >
            <Printer className="size-4" /> PDF report
          </Link>
          <button
            onClick={() =>
              exportCsv(`flipledger-schedule-c-${year}.csv`, lines.map((l) => ({ Line: l.line, Description: l.label, Amount: usd(l.cents) })))
            }
            className="flex h-12 items-center justify-center gap-2 rounded-2xl border bg-card font-bold"
          >
            <Download className="size-4" /> Schedule C CSV
          </button>
          <button
            onClick={() => exportCsv(`flipledger-sales-${year}.csv`, salesRows(items, year))}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl border bg-card font-bold"
          >
            <FileText className="size-4" /> Sales CSV
          </button>
          <button
            onClick={() => {
              const log = mileageLog(expenses, year)
              if (!log.length) return void toast("No trips logged for " + year)
              void exportCsv(`flipledger-mileage-log-${year}.csv`, log)
            }}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl border bg-card font-bold"
          >
            <Car className="size-4" /> Mileage log
          </button>
        </div>
      </section>
    </>
  )
}

function PlatformRow({ row: r, year }: { row: ReconcileRow; year: number }) {
  const [value, setValue] = useState(r.reportedEntered ? centsToInput(r.reported) : "")
  const [pending, start] = useTransition()
  const save = (grossCents: number | null) =>
    start(async () => {
      const res = await saveTaxForm({ year, platform: r.platform, grossCents })
      if (!res.ok) toast.error(res.error)
      else toast.success(grossCents === null ? "Cleared" : "1099-K total saved")
    })
  const gap: [string, number][] = [
    ["Platform fees", r.fees],
    ["Shipping labels", r.labels],
    ["Cost of goods sold", r.cogs],
  ]

  return (
    <div className="rounded-2xl border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-bold">{TAX_PLATFORM_LABELS[r.platform]}</p>
        <p className="font-mono text-sm text-muted-foreground">Logged gross {formatCents(r.trackedGross)}</p>
      </div>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          save(value.trim() ? toCents(value) : null)
        }}
      >
        <div className="min-w-0 flex-1">
          <label className="text-xs text-muted-foreground">Gross on your 1099-K (box 1a)</label>
          <MoneyInput value={value} onChange={setValue} />
        </div>
        <button disabled={pending} className="h-12 shrink-0 rounded-2xl bg-brand px-4 font-bold text-ink disabled:opacity-60">
          Save
        </button>
      </form>
      <div className="mt-3 flex flex-col gap-1 font-mono text-xs">
        <Row label={r.reportedEntered ? "1099-K gross" : "Gross (logged, no 1099-K entered)"} cents={r.reported} />
        {r.reportedEntered && r.unexplained !== 0 && (
          <Row
            label={r.unexplained > 0 ? "Sales tax or sales not logged here" : "Logged here but not on the 1099-K"}
            cents={-r.unexplained}
            muted
          />
        )}
        {r.shippingCollected > 0 && (
          <p className="text-muted-foreground">Includes {formatCents(r.shippingCollected)} shipping buyers paid, offset by your labels below</p>
        )}
        {gap.map(([label, cents]) => cents > 0 && <Row key={label} label={`− ${label}`} cents={-cents} muted />)}
        <div className="mt-1 flex justify-between border-t pt-1.5 font-semibold">
          <span>Profit from {TAX_PLATFORM_LABELS[r.platform]}</span>
          <span className={r.net < 0 ? "text-loss" : "text-profit"}>{formatCents(r.net)}</span>
        </div>
      </div>
    </div>
  )
}

function Row({ label, cents, muted }: { label: string; cents: number; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-2", muted && "text-muted-foreground")}>
      <span>{label}</span>
      <span>{formatCents(cents)}</span>
    </div>
  )
}

function Quarterly({ items, expenses, subs, settings, year }: Omit<Props, "forms">) {
  const now = new Date()
  const quarters = irsQuarters(year)
  return (
    <section className="flex flex-col gap-3 rounded-3xl border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-bold">Quarterly Estimated Taxes</h2>
        <p className="text-sm text-muted-foreground">
          What to set aside each quarter: income tax at your {Math.round(settings.tax_bracket * 100)}% bracket plus 15.3% self-employment tax.
          Confirm with your tax pro.
        </p>
      </div>
      {quarters.map((q) => {
        const r = periodReport(items, expenses, subs, q.period, now)
        const est = estimatedTax(r.netProfit, settings.tax_bracket)
        const started = q.period.from <= now
        const past = q.due < now
        return (
          <div key={q.n} className={cn("flex items-center gap-3 rounded-2xl border px-3 py-3", !started && "opacity-50")}>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted font-mono font-bold">Q{q.n}</span>
            <span className="min-w-0 flex-1 text-sm">
              <span className="block font-semibold">
                Due {q.due.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                {past && <span className="font-normal text-muted-foreground"> · passed</span>}
              </span>
              <span className="block font-mono text-xs text-muted-foreground">Profit {formatCents(r.netProfit)}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-mono font-bold">{formatCents(est.total)}</span>
              <span className="block text-xs text-muted-foreground">set aside</span>
            </span>
          </div>
        )
      })}
    </section>
  )
}

function salesRows(items: Item[], year: number) {
  return items
    .filter((i) => i.status === "sold" && i.sold_at && new Date(i.sold_at).getFullYear() === year)
    .sort((a, b) => a.sold_at!.localeCompare(b.sold_at!))
    .map((i) => {
      const r = yearReport([i], [], [], year)
      const p = r.platforms[0]
      return {
        "Sold date": new Date(i.sold_at!).toLocaleDateString("en-US"),
        Item: i.title ?? `Item #${i.seq}`,
        Platform: p ? TAX_PLATFORM_LABELS[p.platform] : "",
        Quantity: i.quantity,
        Gross: usd(r.totals.gross),
        "Shipping collected": usd(r.totals.shippingCollected),
        Fees: usd(r.totals.fees),
        "Shipping label": usd(r.totals.labels),
        "Cost of goods": usd(r.totals.cogs),
        "Cost entered": i.cost_unknown ? "No" : "Yes",
        Profit: usd(r.totals.net),
      }
    })
}
