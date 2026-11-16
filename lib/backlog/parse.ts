// Reading spreadsheets from other trackers: CSV text and Excel cells, turned into
// plain string tables. Pure: no I/O. The .xlsx reader itself runs in the browser
// (components/backlog/backlog-import.tsx) and hands its cells to `cellText`.

export type Table = { name: string; rows: string[][] }

/** The delimiter the first lines use most: comma, semicolon (European Excel) or tab. */
function sniffDelimiter(text: string): string {
  const head = text.split(/\r?\n/, 5).join("\n")
  const count = (d: string) => head.split(d).length - 1
  return [",", ";", "\t"].reduce((best, d) => (count(d) > count(best) ? d : best), ",")
}

/** RFC 4180 CSV: quoted cells, doubled quotes, commas and newlines inside quotes, a BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "")
  const delim = sniffDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"' && cell === "") quoted = true
    else if (ch === delim) {
      row.push(cell)
      cell = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else cell += ch
  }
  if (cell !== "" || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""))
}

/** An Excel cell as text. Dates become yyyy-mm-dd (Excel dates have no time zone). */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10)
  if (typeof v === "number") return String(Math.round(v * 1e6) / 1e6)
  return String(v)
}

/**
 * Where the headers are: the first row with at least two filled cells (sheets often
 * start with a title line). Returns the header names and the data rows under them.
 */
export function splitHeader(rows: string[][]): { headers: string[]; rows: string[][] } {
  const at = rows.findIndex((r) => r.filter((c) => c.trim()).length >= 2)
  if (at < 0) return { headers: [], rows: [] }
  const width = Math.max(...rows.slice(at).map((r) => r.length))
  const headers = Array.from({ length: width }, (_, i) => rows[at][i]?.trim() || `Column ${i + 1}`)
  return { headers, rows: rows.slice(at + 1).filter((r) => r.some((c) => c.trim() !== "")) }
}

// ---- Google Sheets links ----

const SHEET_URL = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:[/?#]|$)/

/** The CSV export link for a Google Sheets link (the tab in its gid), or null if it isn't one. */
export function sheetCsvUrl(link: string): string | null {
  const url = link.trim()
  const id = SHEET_URL.exec(url)?.[1]
  if (!id) return null
  const gid = /[#?&]gid=(\d+)/.exec(url)?.[1]
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}`
}
