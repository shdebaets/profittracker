"use client"

import { CalendarClock, ChevronRight, PiggyBank } from "lucide-react"
import Link from "next/link"
import { useTransition } from "react"
import { toast } from "sonner"
import { saveTaxBracket } from "@/app/(app)/actions/expenses"
import { formatCents } from "@/lib/money"
import {
  daysBetween, estimatedTax, nextQuarter, periodReport, TAX_BRACKETS, taxSavings, yearPeriod,
} from "@/lib/tax"
import type { Expense, Item, Settings, Subscription } from "@/lib/types"

/** "You've saved $X in taxes this year", plus a heads-up when a quarterly payment is near. */
export function TaxSavingsCard({
  items, expenses, subs, settings,
}: { items: Item[]; expenses: Expense[]; subs: Subscription[]; settings: Settings }) {
  const now = new Date()
  const year = now.getFullYear()
  const r = periodReport(items, expenses, subs, yearPeriod(year), now)
  const { savings, deductions } = taxSavings(r, settings.tax_bracket)
  const q = nextQuarter(now)
  const days = daysBetween(now, q.due)
  const quarter = periodReport(items, expenses, subs, q.period, now)
  const setAside = estimatedTax(quarter.netProfit, settings.tax_bracket).total
  const [pending, start] = useTransition()

  return (
    <section className="rounded-3xl border bg-card p-5 shadow-sm">
      <Link href="/taxes" className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-profit-soft">
          <PiggyBank className="size-5 text-profit" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold tracking-wider text-muted-foreground uppercase">Tax savings {year}</span>
          <span className="mt-0.5 block text-lg leading-snug font-bold">
            You&apos;ve saved <span className="font-mono text-profit">{formatCents(savings)}</span> in taxes this year
          </span>
          <span className="mt-1 block font-mono text-xs text-muted-foreground">
            {formatCents(deductions)} in write-offs × {Math.round(settings.tax_bracket * 100)}% bracket
          </span>
        </span>
        <ChevronRight className="mt-3 size-5 shrink-0 text-muted-foreground" />
      </Link>

      {!settings.tax_bracket_set && (
        <div className="mt-4 rounded-2xl bg-muted/60 p-3">
          <p className="text-sm font-semibold">What&apos;s your tax bracket?</p>
          <p className="text-xs text-muted-foreground">We&apos;re using 22% until you pick one.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {TAX_BRACKETS.map((b) => (
              <button
                key={b}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await saveTaxBracket(b)
                    if (res.ok) toast.success(`Tax bracket set to ${Math.round(b * 100)}%`)
                    else toast.error(res.error)
                  })
                }
                className="rounded-xl border bg-card px-3 py-1.5 font-mono text-sm font-semibold disabled:opacity-50"
              >
                {Math.round(b * 100)}%
              </button>
            ))}
          </div>
        </div>
      )}

      {days <= 30 && setAside > 0 && (
        <Link href="/taxes" className="mt-4 flex items-center gap-3 rounded-2xl border border-brand/40 bg-brand-soft px-3 py-3 text-sm">
          <CalendarClock className="size-5 shrink-0 text-brand" />
          <span className="min-w-0 flex-1">
            Q{q.n} estimated tax is due {q.due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            {days === 0 ? " (today)" : ` (${days} day${days === 1 ? "" : "s"})`}. Set aside about{" "}
            <b className="font-mono">{formatCents(setAside)}</b>.
          </span>
        </Link>
      )}
    </section>
  )
}
