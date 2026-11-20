// Tax estimates for resellers: tax savings, quarterly set-asides, 1099-K
// reconciliation and a Schedule C summary. Pure functions, all money in cents.
// Every figure is an estimate; the UI always says "Not tax advice".

import { itemSale } from "./profit"
import type { MarketplaceId } from "./marketplaces/registry"
import type { CancelledSale, Expense, Item, Subscription } from "./types"

export const TAX_DISCLAIMER = "Estimates only. Not tax advice. Review with your tax professional."

/** Federal brackets offered in Settings. 22% is the default for people who skip it. */
export const TAX_BRACKETS = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37] as const
export const DEFAULT_TAX_BRACKET = 0.22

export type FilingStatus = "single" | "mfj" | "hoh"
export const FILING_STATUSES: FilingStatus[] = ["single", "mfj", "hoh"]
export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  single: "Single",
  mfj: "Married filing jointly",
  hoh: "Head of household",
}

/**
 * Federal standard deduction and bracket starts for tax year 2026, in cents.
 * `starts[i]` is the taxable income above which `rates[i + 1]` applies.
 * Source: IRS Rev. Proc. 2025-32 §4.01 (tax rate tables) and §4.14 (standard deduction),
 * https://www.irs.gov/pub/irs-drop/rp-25-32.pdf, and IR-2025-103,
 * https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill
 * Update every year when the IRS publishes the next year's numbers (each October).
 */
export const FEDERAL_BRACKETS = {
  taxYear: 2026,
  rates: TAX_BRACKETS,
  byStatus: {
    single: { standardDeduction: 1_610_000, starts: [1_240_000, 5_040_000, 10_570_000, 20_177_500, 25_622_500, 64_060_000] },
    mfj: { standardDeduction: 3_220_000, starts: [2_480_000, 10_080_000, 21_140_000, 40_355_000, 51_245_000, 76_870_000] },
    hoh: { standardDeduction: 2_415_000, starts: [1_770_000, 6_745_000, 10_570_000, 20_175_000, 25_620_000, 64_060_000] },
  } satisfies Record<FilingStatus, { standardDeduction: number; starts: number[] }>,
} as const

/** The federal bracket for a year's expected income: income minus the standard deduction, then the rate that taxable income falls in. */
export function bracketFromIncome(incomeCents: number, status: FilingStatus) {
  const { standardDeduction, starts } = FEDERAL_BRACKETS.byStatus[status]
  const taxableCents = Math.max(0, Math.round(incomeCents) - standardDeduction)
  const index = starts.filter((s) => taxableCents > s).length
  return { rate: FEDERAL_BRACKETS.rates[index], taxableCents, standardDeductionCents: standardDeduction }
}

/** Self-employment tax: 15.3% on 92.35% of net earnings. */
const SE_RATE = 0.153
const SE_BASE = 0.9235

export type TaxPlatform = "ebay" | "mercari" | "poshmark" | "facebook" | "depop" | "local" | "other"

export const TAX_PLATFORM_LABELS: Record<TaxPlatform, string> = {
  ebay: "eBay",
  mercari: "Mercari",
  poshmark: "Poshmark",
  facebook: "Facebook Marketplace",
  depop: "Depop",
  local: "Cash / local",
  other: "Other",
}

/** Platforms that send a 1099-K. Cash and other sales don't get one. */
export const ISSUES_1099K: TaxPlatform[] = ["ebay", "mercari", "poshmark", "facebook", "depop"]

const MARKETPLACE_PLATFORM: Partial<Record<MarketplaceId, TaxPlatform>> = {
  ebay: "ebay",
  mercari: "mercari",
  poshmark: "poshmark",
  facebook: "facebook",
  depop: "depop",
}

/** Where a sale happened: its sold cross-listing first, else the fee preset the seller picked. */
export function salePlatform(item: Item): TaxPlatform {
  const sold = item.listings?.find((l) => l.status === "sold")
  const fromListing = sold && MARKETPLACE_PLATFORM[sold.marketplace]
  if (fromListing) return fromListing
  switch (item.platform) {
    case "ebay":
      return "ebay"
    case "mercari_depop":
      return "mercari"
    case "poshmark_amz":
      return "poshmark"
    case "facebook":
      return "facebook"
    case "cash":
      return "local"
    default:
      return "other"
  }
}

export function yearOf(iso: string | null | undefined): number | null {
  return iso ? new Date(iso).getFullYear() : null
}

// ---------- Year totals ----------

export type PlatformTotals = {
  platform: TaxPlatform
  sales: number
  /** Item price × qty plus shipping the buyer paid: what the marketplace counts as gross. */
  gross: number
  shippingCollected: number
  /** Sales tax the marketplace collected: on the 1099-K, never income. */
  salesTax: number
  /** Refunded to buyers after the sale. */
  refunds: number
  /** Cancelled sales that can still be counted on a 1099-K (gross). */
  cancelled: number
  fees: number
  labels: number
  cogs: number
  net: number
}

/** Expense categories mapped to Schedule C lines. */
export const SCHEDULE_C_EXPENSE_LINES: Record<string, { line: string; label: string }> = {
  Packaging: { line: "22", label: "Supplies" },
  "Shipping Supplies": { line: "22", label: "Supplies" },
  Equipment: { line: "22", label: "Supplies" },
  "Platform Fees": { line: "10", label: "Commissions and fees" },
  Software: { line: "27a", label: "Other expenses" },
  Storage: { line: "20b", label: "Rent or lease (other business property)" },
  Travel: { line: "24a", label: "Travel" },
  Meals: { line: "24b", label: "Deductible meals (50%)" },
  Other: { line: "27a", label: "Other expenses" },
}

export type YearReport = {
  year: number
  platforms: PlatformTotals[]
  totals: Omit<PlatformTotals, "platform">
  /** Sales whose cost wasn't entered: COGS is understated for these. */
  unknownCostSales: number
  miles: number
  trips: number
  mileageCents: number
  /** Expense category -> cents (excludes mileage). */
  expensesByCategory: Record<string, number>
  expenseCents: number
  subscriptionCents: number
  /** Net profit after COGS, fees, labels, mileage, expenses and subscriptions. */
  netProfit: number
}

function emptyTotals(): Omit<PlatformTotals, "platform"> {
  return { sales: 0, gross: 0, shippingCollected: 0, salesTax: 0, refunds: 0, cancelled: 0, fees: 0, labels: 0, cogs: 0, net: 0 }
}

/** Range filter: [from, to) in local time. */
export type Period = { from: Date; to: Date }

export function yearPeriod(year: number): Period {
  return { from: new Date(year, 0, 1), to: new Date(year + 1, 0, 1) }
}

function inPeriod(iso: string | null | undefined, p: Period) {
  if (!iso) return false
  const t = new Date(iso)
  return t >= p.from && t < p.to
}

export function periodReport(
  items: Item[],
  expenses: Expense[],
  subs: Subscription[],
  period: Period,
  now = new Date(),
  cancelled: CancelledSale[] = [],
): Omit<YearReport, "year"> {
  const byPlatform = new Map<TaxPlatform, PlatformTotals>()
  const totals = emptyTotals()
  let unknownCostSales = 0

  for (const i of items) {
    if (i.status !== "sold" || !inPeriod(i.sold_at, period)) continue
    const s = itemSale(i)
    const p = salePlatform(i)
    const row = byPlatform.get(p) ?? { platform: p, ...emptyTotals() }
    for (const t of [row, totals]) {
      t.sales++
      t.gross += s.revenue
      t.shippingCollected += i.buyer_shipping_cents ?? 0
      t.salesTax += i.sales_tax_cents ?? 0
      t.refunds += i.refund_cents ?? 0
      t.fees += s.fees
      t.labels += s.shipping
      t.cogs += s.cog
      t.net += s.net
    }
    byPlatform.set(p, row)
    if (i.cost_unknown) unknownCostSales++
  }

  for (const c of cancelled) {
    if (!inPeriod(c.cancelled_at, period)) continue
    const p = c.platform
    const row = byPlatform.get(p) ?? { platform: p, ...emptyTotals() }
    row.cancelled += c.gross_cents
    totals.cancelled += c.gross_cents
    byPlatform.set(p, row)
  }

  let miles = 0, trips = 0, mileageCents = 0, expenseCents = 0
  const expensesByCategory: Record<string, number> = {}
  for (const e of expenses) {
    if (!inPeriod(e.spent_at, period)) continue
    if (e.kind === "mileage") {
      miles += Number(e.miles ?? 0)
      trips++
      mileageCents += e.amount_cents
    } else {
      expenseCents += e.amount_cents
      expensesByCategory[e.category] = (expensesByCategory[e.category] ?? 0) + e.amount_cents
    }
  }

  let subscriptionCents = 0
  const lastMonth = new Date(Math.min(now.getTime(), period.to.getTime() - 1))
  for (const s of subs) {
    if (!s.active) continue
    const [sy, sm] = s.started_at.split("-").map(Number)
    const startIdx = Math.max(sy * 12 + (sm - 1), period.from.getFullYear() * 12 + period.from.getMonth())
    const endIdx = lastMonth.getFullYear() * 12 + lastMonth.getMonth()
    subscriptionCents += s.amount_cents * Math.max(0, endIdx - startIdx + 1)
  }

  const order = Object.keys(TAX_PLATFORM_LABELS) as TaxPlatform[]
  return {
    platforms: [...byPlatform.values()].sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform)),
    totals,
    unknownCostSales,
    miles: Math.round(miles * 10) / 10,
    trips,
    mileageCents,
    expensesByCategory,
    expenseCents,
    subscriptionCents,
    netProfit: totals.net - mileageCents - expenseCents - subscriptionCents,
  }
}

export function yearReport(
  items: Item[],
  expenses: Expense[],
  subs: Subscription[],
  year: number,
  now = new Date(),
  cancelled: CancelledSale[] = [],
): YearReport {
  return { year, ...periodReport(items, expenses, subs, yearPeriod(year), now, cancelled) }
}

// ---------- Tax savings ----------

/** Deductions × bracket: (mileage + expenses + subscriptions + COGS) × bracket. */
export function taxSavings(r: Omit<YearReport, "year">, bracket: number) {
  const deductions = r.mileageCents + r.expenseCents + r.subscriptionCents + r.totals.cogs
  return { deductions, savings: Math.round(deductions * bracket) }
}

// ---------- Quarterly estimates ----------

export type Quarter = {
  n: 1 | 2 | 3 | 4
  /** IRS payment periods: Jan–Mar, Apr–May, Jun–Aug, Sep–Dec. */
  period: Period
  /** Due date (local midnight). Q4 is due Jan 15 of the next year. */
  due: Date
}

export function irsQuarters(year: number): Quarter[] {
  return [
    { n: 1, period: { from: new Date(year, 0, 1), to: new Date(year, 3, 1) }, due: new Date(year, 3, 15) },
    { n: 2, period: { from: new Date(year, 3, 1), to: new Date(year, 5, 1) }, due: new Date(year, 5, 15) },
    { n: 3, period: { from: new Date(year, 5, 1), to: new Date(year, 8, 1) }, due: new Date(year, 8, 15) },
    { n: 4, period: { from: new Date(year, 8, 1), to: new Date(year + 1, 0, 1) }, due: new Date(year + 1, 0, 15) },
  ]
}

/** The next quarterly payment due on or after today (Q4 of last year in early January). */
export function nextQuarter(now = new Date()): Quarter & { year: number } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  for (const year of [now.getFullYear() - 1, now.getFullYear()]) {
    for (const q of irsQuarters(year)) if (q.due >= today) return { ...q, year }
  }
  return { ...irsQuarters(now.getFullYear() + 1)[0], year: now.getFullYear() + 1 }
}

/** Estimated federal income tax + self-employment tax on a period's net profit. */
export function estimatedTax(netProfitCents: number, bracket: number) {
  const net = Math.max(0, netProfitCents)
  const se = Math.round(net * SE_BASE * SE_RATE)
  const income = Math.round(Math.max(0, net - se / 2) * bracket)
  return { se, income, total: se + income }
}

/**
 * Which quarterly reminder is due `days` before a payment: the week-before one (sent on days 7 to 2)
 * or the day-before one (days 1 and 0). A window instead of an exact day, so a cron run that was
 * missed still sends late; `email_log` keeps each one to a single send.
 */
export function taxReminderWindow(days: number): 7 | 1 | null {
  if (days < 0 || days > 7) return null
  return days <= 1 ? 1 : 7
}

export function daysBetween(a: Date, b: Date) {
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((day(b) - day(a)) / 86_400_000)
}

// ---------- 1099-K reconciliation ----------

export type ReconcileRow = {
  platform: TaxPlatform
  /** What the 1099-K says (typed in by the seller), or our tracked gross if they haven't. */
  reported: number
  reportedEntered: boolean
  trackedGross: number
  /** What the 1099-K should show from what's logged: gross + sales tax + cancelled sales. */
  expected: number
  /** Reported minus expected: sales not logged here, or sales tax we don't know about. */
  unexplained: number
  shippingCollected: number
  salesTax: number
  refunds: number
  cancelled: number
  fees: number
  labels: number
  cogs: number
  net: number
}

export function reconcile(report: Omit<YearReport, "year">, forms: Partial<Record<TaxPlatform, number>>): ReconcileRow[] {
  const platforms = new Set<TaxPlatform>([
    ...report.platforms.map((p) => p.platform).filter((p) => ISSUES_1099K.includes(p)),
    ...(Object.keys(forms) as TaxPlatform[]),
  ])
  return [...platforms]
    .sort((a, b) => ISSUES_1099K.indexOf(a) - ISSUES_1099K.indexOf(b))
    .map((platform) => {
      const t = report.platforms.find((p) => p.platform === platform) ?? { platform, ...emptyTotals() }
      const entered = forms[platform]
      const expected = t.gross + t.salesTax + t.cancelled
      const reported = entered ?? expected
      return {
        platform,
        reported,
        reportedEntered: entered !== undefined,
        trackedGross: t.gross,
        expected,
        unexplained: reported - expected,
        shippingCollected: t.shippingCollected,
        salesTax: t.salesTax,
        refunds: t.refunds,
        cancelled: t.cancelled,
        fees: t.fees,
        labels: t.labels,
        cogs: t.cogs,
        net: t.net,
      }
    })
}

// ---------- Year gap: 1099-K gross down to net profit ----------

export type GapStep = { label: string; cents: number; kind: "start" | "minus" | "subtotal" | "end" }

/**
 * The whole tax year as one waterfall, from what the IRS sees (1099-K gross) to what the
 * seller actually made. Each "minus" step is a positive amount that gets taken off.
 * Gross that isn't on any 1099-K (cash, local) is added back so the end is real net profit.
 */
export function gapBreakdown(report: Omit<YearReport, "year">, rows: ReconcileRow[]): GapStep[] {
  const irs = rows.reduce((a, r) => a + r.reported, 0)
  const salesTax = rows.reduce((a, r) => a + r.salesTax, 0)
  const cancelled = rows.reduce((a, r) => a + r.cancelled, 0)
  const unexplained = rows.reduce((a, r) => a + r.unexplained, 0)
  const formGross = rows.reduce((a, r) => a + r.trackedGross, 0)
  const nonForm = report.totals.gross - formGross
  const steps: GapStep[] = [{ label: "What the IRS sees (1099-K gross)", cents: irs, kind: "start" }]
  const minus = (label: string, cents: number) => cents && steps.push({ label, cents, kind: "minus" })
  minus("Sales tax the marketplace collected", salesTax)
  minus("Cancelled sales", cancelled)
  if (unexplained > 0) minus("On the 1099-K but not logged here", unexplained)
  if (unexplained < 0) minus("Logged here but not on a 1099-K", unexplained)
  if (nonForm) steps.push({ label: "Cash and local sales (no 1099-K)", cents: -nonForm, kind: "minus" })
  minus("Refunds to buyers", report.totals.refunds)
  steps.push({
    label: "Gross receipts (incl. shipping buyers paid)",
    cents: report.totals.gross - report.totals.refunds,
    kind: "subtotal",
  })
  minus("Platform fees", report.totals.fees)
  minus("Shipping labels", report.totals.labels)
  minus("Cost of goods sold", report.totals.cogs)
  minus("Mileage", report.mileageCents)
  minus("Expenses", report.expenseCents)
  minus("Subscriptions", report.subscriptionCents)
  steps.push({ label: "What you actually made (net profit)", cents: report.netProfit, kind: "end" })
  return steps
}

// ---------- Schedule C ----------

export type ScheduleCLine = { line: string; label: string; cents: number }

export function scheduleC(r: YearReport): ScheduleCLine[] {
  const otherExpenseLines = new Map<string, ScheduleCLine>()
  const add = (line: string, label: string, cents: number) => {
    if (!cents) return
    const key = `${line}|${label}`
    const cur = otherExpenseLines.get(key)
    if (cur) cur.cents += cents
    else otherExpenseLines.set(key, { line, label, cents })
  }
  add("9", "Car and truck expenses (standard mileage)", r.mileageCents)
  add("10", "Commissions and fees (marketplace fees)", r.totals.fees)
  for (const [cat, cents] of Object.entries(r.expensesByCategory)) {
    const m = SCHEDULE_C_EXPENSE_LINES[cat] ?? SCHEDULE_C_EXPENSE_LINES.Other
    // Meals are only 50% deductible.
    add(m.line, m.label, cat === "Meals" ? Math.round(cents / 2) : cents)
  }
  add("27a", "Other expenses (shipping labels / postage)", r.totals.labels)
  add("27a", "Other expenses (software subscriptions)", r.subscriptionCents)

  const expenses = [...otherExpenseLines.values()].sort((a, b) => lineOrder(a.line) - lineOrder(b.line))
  const totalExpenses = expenses.reduce((a, l) => a + l.cents, 0)
  const grossProfit = r.totals.gross - r.totals.refunds - r.totals.cogs
  return [
    { line: "1", label: "Gross receipts or sales", cents: r.totals.gross },
    { line: "2", label: "Returns and allowances", cents: r.totals.refunds },
    { line: "4", label: "Cost of goods sold (Part III)", cents: r.totals.cogs },
    { line: "7", label: "Gross income", cents: grossProfit },
    ...expenses,
    { line: "28", label: "Total expenses", cents: totalExpenses },
    { line: "31", label: "Net profit (estimate)", cents: grossProfit - totalExpenses },
  ]
}

function lineOrder(line: string) {
  return parseFloat(line) + (/[a-z]$/.test(line) ? (line.charCodeAt(line.length - 1) - 96) / 10 : 0)
}

// ---------- Mileage log ----------

export function mileageLog(expenses: Expense[], year: number) {
  return expenses
    .filter((e) => e.kind === "mileage" && yearOf(e.spent_at) === year)
    .sort((a, b) => a.spent_at.localeCompare(b.spent_at))
    .map((e) => ({
      Date: new Date(e.spent_at).toLocaleDateString("en-US"),
      "Business purpose": e.title.replace(/^Mileage:\s*/, ""),
      "Start location": e.start_location ?? "",
      "End location": e.end_location ?? "",
      Miles: Number(e.miles ?? 0).toFixed(1),
      "Rate per mile": ((e.rate_cents ?? 0) / 100).toFixed(2),
      Deduction: (e.amount_cents / 100).toFixed(2),
    }))
}
