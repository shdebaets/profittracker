"use client"

import { FileSpreadsheet, Loader2, Undo2, Upload } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { fetchGoogleSheet, importBacklogExpenses, importBacklogItems, undoBacklogImport } from "@/app/(app)/actions/backlog"
import { NativeSelect, TextInput } from "@/components/fields"
import { EXPENSE_FIELDS, guessMapping, ITEM_FIELDS, type ImportKind, type Mapping } from "@/lib/backlog/columns"
import { cellText, parseCsv, splitHeader, type Table } from "@/lib/backlog/parse"
import { makeRefs, mapExpenseRow, mapItemRow, type ExpenseRow, type ItemRow } from "@/lib/backlog/rows"
import { exportCsv } from "@/lib/csv"
import { GENERIC_ERROR } from "@/lib/errors"
import { cn } from "@/lib/utils"

const BATCH = 200
/** Shown even when the sheet has no match; the rest only when matched or "More columns" is open. */
const MAIN_FIELDS = new Set(["title", "quantity", "cost", "purchasedAt", "store", "soldAt", "salePrice", "fees", "labelCost", "platform", "status"])
const MAX_ROWS = 5000
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`

const TEMPLATES: Record<ImportKind, Record<string, string>[]> = {
  items: [
    { title: "Nike Tech Fleece Hoodie", quantity: "1", unit_cost: "12.00", store: "Goodwill", purchased_at: "2025-03-01", status: "sold", sold_at: "2025-03-20", platform: "eBay", unit_sale_price: "65.00", buyer_shipping: "0", fees: "8.61", label_cost: "7.50", link: "" },
    { title: "Lego 75192 sealed", quantity: "2", unit_cost: "", store: "Target clearance", purchased_at: "2025-04-02", status: "inventory", sold_at: "", platform: "", unit_sale_price: "", buyer_shipping: "", fees: "", label_cost: "", link: "" },
  ],
  expenses: [
    { date: "2025-03-01", description: "Poly mailers 100ct", category: "Packaging", amount: "24.99", miles: "" },
    { date: "2025-03-02", description: "Goodwill outlet run", category: "", amount: "", miles: "18.4" },
  ],
}

type Loaded = { file: string; tables: Table[] }
type Done = { batch: string; added: number; skipped: number; kind: ImportKind }

/** Bring inventory, sales and expenses over from another tracker or a spreadsheet. */
export function BacklogImport({ mileageRateCents }: { mileageRateCents: number }) {
  const [kind, setKind] = useState<ImportKind>("items")
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [tab, setTab] = useState(0)
  const [mapping, setMapping] = useState<Mapping<string> | null>(null)
  const [link, setLink] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [showBad, setShowBad] = useState(false)
  const [allFields, setAllFields] = useState(false)
  const [done, setDone] = useState<Done | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const fields = kind === "items" ? ITEM_FIELDS : EXPENSE_FIELDS
  const table = useMemo(() => (loaded ? splitHeader(loaded.tables[tab]?.rows ?? []) : null), [loaded, tab])

  /** Show a file's columns; without a tab picked, the first tab that has rows (workbooks often start with a notes tab). */
  function open(next: Loaded, pick?: number) {
    const sheet = pick ?? Math.max(0, next.tables.findIndex((s) => splitHeader(s.rows).rows.length > 0))
    const t = splitHeader(next.tables[sheet]?.rows ?? [])
    if (!t.rows.length) return void toast.error(pick === undefined ? "That file has no rows under its headers." : "That tab has no rows under its headers.")
    setLoaded(next)
    setTab(sheet)
    setMapping(guessMapping(fields as readonly { key: string; label: string; synonyms: string[] }[], t.headers))
    setDone(null)
    setShowBad(false)
  }

  function pickTab(i: number) {
    if (!loaded) return
    open(loaded, i)
  }

  function switchKind(k: ImportKind) {
    setKind(k)
    setLoaded(null)
    setMapping(null)
    setDone(null)
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    if (file.size > 20 * 1024 * 1024) return void toast.error("That file is over 20MB. Split it into smaller files.")
    setBusy("Reading the file…")
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const { default: readXlsxFile } = await import("read-excel-file/browser")
        const sheets = await readXlsxFile(file)
        open({ file: file.name, tables: sheets.map((s) => ({ name: s.sheet, rows: s.data.map((r) => r.map(cellText)) })) })
      } else if (/\.(xls|numbers)$/i.test(file.name)) {
        toast.error("Save it as .xlsx or .csv first (File → Save As / Download), then upload that.")
      } else {
        open({ file: file.name, tables: [{ name: file.name, rows: parseCsv(await file.text()) }] })
      }
    } catch {
      toast.error("Couldn't read that file. Upload a .csv or .xlsx spreadsheet.")
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  async function onLink() {
    setBusy("Opening the sheet…")
    const res = await fetchGoogleSheet(link)
    setBusy(null)
    if (!res.ok) return void toast.error(res.error)
    open({ file: "Google Sheet", tables: [{ name: "Google Sheet", rows: parseCsv(res.data) }] })
  }

  // Every row mapped with the current column choices; recomputed as the seller changes them.
  const result = useMemo(() => {
    if (!table || !mapping) return null
    const ref = makeRefs()
    const now = new Date()
    const good: (ItemRow | ExpenseRow)[] = []
    const bad: { line: number; reason: string }[] = []
    // Data starts one line under the header; spreadsheet lines are 1-based.
    const offset = (loaded?.tables[tab]?.rows.length ?? 0) - table.rows.length + 1
    table.rows.slice(0, MAX_ROWS).forEach((cells, i) => {
      const r = kind === "items"
        ? mapItemRow(cells, mapping as Mapping<(typeof ITEM_FIELDS)[number]["key"]>, i + offset, ref, now)
        : mapExpenseRow(cells, mapping as Mapping<(typeof EXPENSE_FIELDS)[number]["key"]>, i + offset, ref, mileageRateCents)
      if (r.ok) good.push(r.row)
      else bad.push({ line: r.line, reason: r.reason })
    })
    return { good, bad, over: Math.max(0, table.rows.length - MAX_ROWS) }
  }, [table, mapping, kind, mileageRateCents, loaded, tab])

  const missing = mapping ? (kind === "items" ? (mapping.title < 0 ? ["Item name"] : []) : [mapping.date < 0 && "Date", mapping.amount < 0 && mapping.miles < 0 && "Amount or Miles"].filter((x): x is string => !!x)) : []

  async function runImport() {
    if (!result?.good.length) return
    const batch = crypto.randomUUID()
    const rows = result.good
    const send = kind === "items" ? importBacklogItems : importBacklogExpenses
    let added = 0
    let skipped = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      setBusy(`Importing… ${Math.min(i + BATCH, rows.length).toLocaleString()} of ${rows.length.toLocaleString()}`)
      const res = await send(batch, rows.slice(i, i + BATCH))
      if (!res.ok) {
        setBusy(null)
        if (added) setDone({ batch, added, skipped, kind })
        return void toast.error(`${res.error ?? GENERIC_ERROR}${added ? ` (${plural(added, "row")} imported before that)` : ""}`)
      }
      added += res.data.added
      skipped += res.data.skipped
    }
    setBusy(null)
    setDone({ batch, added, skipped, kind })
    setLoaded(null)
    setMapping(null)
    toast.success(`Imported ${plural(added, kind === "items" ? "item" : "expense")}.`)
  }

  async function undo() {
    if (!done) return
    setBusy("Undoing…")
    const res = await undoBacklogImport(done.batch)
    setBusy(null)
    if (!res.ok) return void toast.error(res.error)
    setDone(null)
    toast.success(`Removed ${plural(res.data.removed, "row")}.${res.data.kept ? ` Kept ${res.data.kept} you've changed since.` : ""}`)
  }

  const items = kind === "items" ? (result?.good as ItemRow[] | undefined) : undefined
  const counts = items && {
    stock: items.filter((r) => r.status === "inventory").length,
    sold: items.filter((r) => r.status === "sold").length,
    returned: items.filter((r) => r.status === "returned").length,
    noCost: items.filter((r) => r.cost_unknown).length,
  }
  const miles = kind === "expenses" ? (result?.good as ExpenseRow[] | undefined)?.filter((r) => r.kind === "mileage").length ?? 0 : 0
  const btn = "flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-bold disabled:opacity-60"
  const sample = (col: number) => table?.rows.find((r) => r[col]?.trim())?.[col]?.trim() ?? ""

  return (
    <section id="import" className="flex scroll-mt-20 flex-col gap-4 rounded-3xl border bg-card p-5 shadow-sm">
      <div>
        <p className="flex items-center gap-1.5 font-semibold"><FileSpreadsheet className="size-4" /> Import from another tracker</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Coming from another app or a spreadsheet? Bring your inventory, past sales and expenses over so your profit and taxes are complete. Export from your old tracker as CSV or Excel, or paste a Google Sheets link.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 text-sm font-semibold">
        {(["items", "expenses"] as const).map((k) => (
          <button key={k} type="button" disabled={!!busy} onClick={() => switchKind(k)}
            className={cn("h-9 rounded-lg", kind === k ? "bg-card shadow-sm" : "text-muted-foreground")}>
            {k === "items" ? "Items & sales" : "Expenses & mileage"}
          </button>
        ))}
      </div>

      {done && (
        <div className="flex flex-col gap-2 rounded-xl bg-profit-soft p-3 text-sm">
          <p>
            Imported <b>{plural(done.added, done.kind === "items" ? "item" : "expense")}</b>
            {done.skipped > 0 && <>; {done.skipped.toLocaleString()} were already in FlipLedger</>}.
          </p>
          <p className="text-muted-foreground">Mapped something wrong? Undo removes this import so you can try again.</p>
          <button type="button" disabled={!!busy} onClick={undo} className={`${btn} self-start border bg-card`}>
            <Undo2 className="size-4" /> Undo this import
          </button>
        </div>
      )}

      {!loaded || !table || !mapping ? (
        <div className="flex flex-col gap-3">
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.numbers,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <button type="button" disabled={!!busy} onClick={() => fileRef.current?.click()} className={`${btn} bg-brand text-ink`}>
            <Upload className="size-4" /> Upload CSV or Excel file
          </button>
          <div className="flex gap-2">
            <TextInput value={link} onChange={(e) => setLink(e.target.value)} placeholder="…or paste a Google Sheets link"
              className="h-11" autoCapitalize="none" autoCorrect="off" inputMode="url" />
            <button type="button" disabled={!!busy || !link.trim()} onClick={onLink} className={`${btn} border bg-card`}>Open</button>
          </div>
          <p className="text-xs text-muted-foreground">
            Google Sheets: share it as &quot;Anyone with the link&quot;, and copy the link while the tab you want is open.{" "}
            <button type="button" className="font-semibold underline"
              onClick={() => exportCsv(`flipledger-${kind}-template.csv`, TEMPLATES[kind])}>
              Download a template
            </button>
          </p>
          {busy && <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> {busy}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2 text-sm">
            <p className="min-w-0 truncate"><b>{loaded.file}</b> · {plural(table.rows.length, "row")}</p>
            <button type="button" disabled={!!busy} onClick={() => { setLoaded(null); setMapping(null) }} className="shrink-0 font-semibold underline">
              Choose another
            </button>
          </div>

          {loaded.tables.length > 1 && (
            <NativeSelect value={tab} onChange={(e) => pickTab(Number(e.target.value))} aria-label="Sheet">
              {loaded.tables.map((t, i) => <option key={i} value={i}>{t.name}</option>)}
            </NativeSelect>
          )}

          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold">Which column is which?</p>
            {fields.map((f) => {
              const col = mapping[f.key] ?? -1
              if (kind === "items" && !allFields && col < 0 && !MAIN_FIELDS.has(f.key)) return null
              return (
                <div key={f.key} className="flex flex-col gap-1">
                  <label htmlFor={`map-${f.key}`} className="text-sm text-foreground/80">
                    {f.label}
                    {"hint" in f && f.hint && <span className="text-xs text-muted-foreground"> · {f.hint}</span>}
                  </label>
                  <NativeSelect id={`map-${f.key}`} value={col} disabled={!!busy}
                    onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}>
                    <option value={-1}>Not in my sheet</option>
                    {table.headers.map((h, i) => (
                      <option key={i} value={i}>{h}{sample(i) ? ` (e.g. ${sample(i).slice(0, 24)})` : ""}</option>
                    ))}
                  </NativeSelect>
                </div>
              )
            })}
            {kind === "items" && !allFields && fields.some((f) => (mapping[f.key] ?? -1) < 0 && !MAIN_FIELDS.has(f.key)) && (
              <button type="button" onClick={() => setAllFields(true)} className="self-start text-sm font-semibold underline">
                More columns (list price, sales tax, brand, size…)
              </button>
            )}
          </div>

          {missing.length > 0 ? (
            <p className="rounded-xl bg-muted/60 p-3 text-sm">Pick a column for: <b>{missing.join(", ")}</b>.</p>
          ) : result && (
            <div className="flex flex-col gap-2 rounded-xl bg-muted/60 p-3 text-sm">
              {counts ? (
                <ul className="list-disc pl-5">
                  {counts.stock > 0 && <li>{plural(counts.stock, "item")} in stock</li>}
                  {counts.sold > 0 && <li>{plural(counts.sold, "sale")}</li>}
                  {counts.returned > 0 && <li>{counts.returned.toLocaleString()} returned</li>}
                  {counts.noCost > 0 && <li>{counts.noCost.toLocaleString()} with no cost (marked Needs Cost)</li>}
                </ul>
              ) : (
                <ul className="list-disc pl-5">
                  {result.good.length - miles > 0 && <li>{plural(result.good.length - miles, "expense")}</li>}
                  {miles > 0 && <li>{plural(miles, "mileage trip")}</li>}
                </ul>
              )}
              {result.over > 0 && <p>Only the first {MAX_ROWS.toLocaleString()} rows are imported at a time; import the rest after.</p>}
              {result.bad.length > 0 && (
                <div>
                  <button type="button" onClick={() => setShowBad(!showBad)} className="font-semibold text-destructive underline">
                    {plural(result.bad.length, "row")} can&apos;t be imported{showBad ? "" : ": see why"}
                  </button>
                  {showBad && (
                    <ul className="mt-1 max-h-48 overflow-y-auto text-xs text-muted-foreground">
                      {result.bad.slice(0, 200).map((b) => <li key={b.line}>Row {b.line}: {b.reason}</li>)}
                      {result.bad.length > 200 && <li>…and {result.bad.length - 200} more</li>}
                    </ul>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Rows you imported before are skipped, so importing the same file again is safe.</p>
            </div>
          )}

          <button type="button" disabled={!!busy || missing.length > 0 || !result?.good.length} onClick={runImport} className={`${btn} bg-brand text-ink`}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ?? `Import ${result?.good.length ? plural(result.good.length, "row") : ""}`}
          </button>
        </div>
      )}
    </section>
  )
}
