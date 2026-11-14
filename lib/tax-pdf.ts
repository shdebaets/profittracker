// The CPA-ready tax report as a real PDF file, built in the browser so tax-year
// boundaries follow the seller's time zone. Plain text and tables, US Letter.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"
import { formatCents } from "./money"
import {
  gapBreakdown, ISSUES_1099K, mileageLog, reconcile, scheduleC, TAX_DISCLAIMER, TAX_PLATFORM_LABELS, taxSavings, yearReport,
  type TaxPlatform,
} from "./tax"
import type { CancelledSale, Expense, Item, Subscription } from "./types"

export type TaxPdfInput = {
  year: number
  email: string
  items: Item[]
  expenses: Expense[]
  subs: Subscription[]
  bracket: number
  forms: Partial<Record<TaxPlatform, number>>
  cancelled: CancelledSale[]
  now?: Date
}

const W = 612, H = 792, M = 48
const GREY = rgb(0.4, 0.4, 0.4)
const BLACK = rgb(0, 0, 0)

/** Standard PDF fonts only cover WinAnsi; swap the few characters we use that it lacks. */
export function pdfText(s: string) {
  return s
    .replace(/[−–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7e -ÿ]/g, "")
}

class Writer {
  page!: PDFPage
  y = 0
  constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont) {
    this.newPage()
  }
  newPage() {
    this.page = this.doc.addPage([W, H])
    this.y = H - M
  }
  need(h: number) {
    if (this.y - h < M) this.newPage()
  }
  text(s: string, { size = 10, bold = false, color = BLACK } = {}) {
    this.need(size + 4)
    this.page.drawText(pdfText(s), { x: M, y: this.y - size, size, font: bold ? this.bold : this.font, color })
    this.y -= size + 5
  }
  /** Wrapped paragraph. */
  para(s: string, size = 9, color = GREY) {
    let line = ""
    for (const word of pdfText(s).split(" ")) {
      const next = line ? `${line} ${word}` : word
      if (line && this.font.widthOfTextAtSize(next, size) > W - 2 * M) {
        this.text(line, { size, color })
        line = word
      } else line = next
    }
    if (line) this.text(line, { size, color })
  }
  heading(s: string) {
    this.y -= 8
    this.need(40)
    this.text(s, { size: 14, bold: true })
    this.y -= 2
  }
  /** One table row. Widths are fractions of the text width; `right` lists right-aligned columns. */
  row(cells: string[], widths: number[], { bold = false, size = 9, right = [] as number[] } = {}) {
    this.need(size + 6)
    const font = bold ? this.bold : this.font
    let x = M
    cells.forEach((c, i) => {
      const w = widths[i] * (W - 2 * M)
      let t = pdfText(c)
      while (t.length > 1 && font.widthOfTextAtSize(t, size) > w - 4) t = t.slice(0, -2) + "."
      const tx = right.includes(i) ? x + w - 4 - font.widthOfTextAtSize(t, size) : x
      this.page.drawText(t, { x: tx, y: this.y - size, size, font })
      x += w
    })
    this.y -= size + 6
    this.page.drawLine({ start: { x: M, y: this.y + 2 }, end: { x: W - M, y: this.y + 2 }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) })
  }
}

export async function buildTaxPdf(input: TaxPdfInput): Promise<Uint8Array> {
  const { year, email, items, expenses, subs, bracket, forms, cancelled, now = new Date() } = input
  const report = yearReport(items, expenses, subs, year, now, cancelled)
  const rows = reconcile(report, forms)
  const steps = gapBreakdown(report, rows)
  const lines = scheduleC(report)
  const log = mileageLog(expenses, year)
  const { deductions, savings } = taxSavings(report, bracket)

  const doc = await PDFDocument.create()
  doc.setTitle(`FlipLedger Tax Report ${year}`)
  doc.setProducer("FlipLedger")
  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold))

  w.text(`FlipLedger Tax Report ${year}`, { size: 20, bold: true })
  w.text(`${email} · Generated ${now.toLocaleDateString("en-US")}`, { size: 9, color: GREY })
  w.y -= 4
  w.para(TAX_DISCLAIMER, 9, BLACK)

  w.heading("From your 1099-K to what you made")
  for (const s of steps) {
    const sign = s.kind === "minus" ? (s.cents < 0 ? "+ " : "- ") : ""
    w.row([sign + s.label, formatCents(s.kind === "minus" ? Math.abs(s.cents) : s.cents)], [0.75, 0.25], {
      bold: s.kind !== "minus",
      right: [1],
    })
  }

  w.heading("1099-K reconciliation by platform")
  const cols = [0.2, 0.13, 0.12, 0.1, 0.1, 0.1, 0.1, 0.15]
  const num = [1, 2, 3, 4, 5, 6, 7]
  w.row(["Platform", "1099-K", "Logged", "Sales tax", "Cancelled", "Fees", "COGS", "Profit"], cols, { bold: true, right: num })
  for (const r of rows) {
    w.row(
      [
        TAX_PLATFORM_LABELS[r.platform],
        r.reportedEntered ? formatCents(r.reported) : "not entered",
        formatCents(r.trackedGross),
        formatCents(r.salesTax),
        formatCents(r.cancelled),
        formatCents(r.fees),
        formatCents(r.cogs),
        formatCents(r.net),
      ],
      cols,
      { right: num },
    )
  }
  for (const p of report.platforms.filter((p) => !ISSUES_1099K.includes(p.platform))) {
    w.row(
      [`${TAX_PLATFORM_LABELS[p.platform]} (no 1099-K)`, "", formatCents(p.gross), "", "", formatCents(p.fees), formatCents(p.cogs), formatCents(p.net)],
      cols,
      { right: num },
    )
  }
  if (report.unknownCostSales > 0) {
    w.para(`${report.unknownCostSales} sale(s) have no cost entered; COGS and profit for those count the cost as $0.`)
  }

  w.heading("Schedule C (Form 1040)")
  for (const l of lines) w.row([l.line, l.label, formatCents(l.cents)], [0.08, 0.67, 0.25], { bold: ["7", "28", "31"].includes(l.line), right: [2] })
  w.y -= 4
  w.para(`Estimated tax savings from write-offs: ${formatCents(savings)} (${Math.round(bracket * 100)}% of ${formatCents(deductions)}).`)

  w.newPage()
  w.heading("Mileage log")
  w.para("Business miles at the standard mileage rate. Locations are as logged (GPS trips show coordinates).")
  if (log.length) {
    const mcols = [0.12, 0.26, 0.2, 0.2, 0.08, 0.14]
    w.row(["Date", "Business purpose", "Start", "End", "Miles", "Deduction"], mcols, { bold: true, size: 8, right: [4, 5] })
    for (const r of log) {
      w.row([r.Date, r["Business purpose"], r["Start location"], r["End location"], r.Miles, `$${r.Deduction}`], mcols, { size: 8, right: [4, 5] })
    }
    w.row(["Total", "", "", "", report.miles.toFixed(1), formatCents(report.mileageCents)], mcols, { bold: true, size: 8, right: [4, 5] })
  } else {
    w.text(`No trips logged for ${year}.`, { size: 9, color: GREY })
  }

  const pages = doc.getPages()
  pages.forEach((p, i) =>
    p.drawText(`FlipLedger · ${year} · Page ${i + 1} of ${pages.length} · Estimates only, not tax advice`, { x: M, y: 24, size: 7, color: GREY }),
  )
  return doc.save()
}
