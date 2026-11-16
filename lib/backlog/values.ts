// Cell values from other trackers' spreadsheets. Each parser returns null for a blank
// cell and undefined for one it can't read, so callers can say which row is wrong.

/** "$1,234.50", "12", "12,50", "USD 9.99" → cents. Negative amounts aren't valid here. */
export function parseMoney(raw: string): number | null | undefined {
  let s = raw.trim().replace(/\s+/g, "")
  if (!s || s === "-" || s === "—") return null
  s = s.replace(/^(usd|us\$|\$)/i, "").replace(/(usd|\$)$/i, "")
  if (/^\(.*\)$/.test(s) || s.startsWith("-")) return undefined
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".") // 12,50 (decimal comma)
  else s = s.replace(/,/g, "") // 1,234.50
  if (!/^\d*\.?\d+$/.test(s)) return undefined
  const cents = Math.round(Number(s) * 100)
  return Number.isFinite(cents) && cents <= 100_000_000 ? cents : undefined
}

/** "15%", "13.25", "0.1325" → a fraction (0.1325). */
export function parsePercent(raw: string): number | null | undefined {
  const s = raw.trim().replace(/\s|%/g, "")
  if (!s) return null
  if (!/^\d*\.?\d+$/.test(s)) return undefined
  const n = Number(s)
  const pct = n > 1 ? n / 100 : n
  return pct <= 0.5 ? pct : undefined
}

/** Whole units, at least 1. Blank means 1. */
export function parseQty(raw: string): number | undefined {
  const s = raw.trim().replace(/,/g, "")
  if (!s) return 1
  const n = Number(s)
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : undefined
}

const noonUtc = (y: number, m: number, d: number): string | undefined => {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return undefined
  const date = new Date(Date.UTC(y, m - 1, d, 12))
  return date.getUTCMonth() === m - 1 ? date.toISOString() : undefined // rejects Feb 30
}
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y))
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

/**
 * A date cell → ISO timestamp. Dates without a time are stored at noon UTC so they
 * show as the same day everywhere. Accepts ISO, US m/d/yyyy (d/m when the first number
 * is over 12), 2-digit years, "Nov 3, 2026", "3 Nov 2026" and Excel serial numbers.
 */
export function parseDate(raw: string): string | null | undefined {
  const s = raw.trim()
  if (!s) return null

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (m) return noonUtc(+m[1], +m[2], +m[3])

  m = /^(\d{4})-(\d{2})-(\d{2})[T ]\d{1,2}:\d{2}/.exec(s)
  if (m) {
    const t = Date.parse(s.replace(" ", "T"))
    return Number.isNaN(t) ? noonUtc(+m[1], +m[2], +m[3]) : new Date(t).toISOString()
  }

  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ T].*)?$/.exec(s)
  if (m) {
    const [a, b, y] = [+m[1], +m[2], fullYear(m[3])]
    return a > 12 ? noonUtc(y, b, a) : noonUtc(y, a, b)
  }

  // Excel serial day numbers (days since 1899-12-30), as plain-number cells.
  m = /^(\d{5})(?:\.\d+)?$/.exec(s)
  if (m) {
    const days = +m[1]
    if (days < 32874 || days > 73050) return undefined // 1990–2100
    const d = new Date(Date.UTC(1899, 11, 30 + days, 12))
    return d.toISOString()
  }

  // "Nov 3, 2026", "November 3 2026", "3 Nov 2026", "Tue Nov 03 2026"
  const words = s.toLowerCase().replace(/,/g, " ").split(/\s+/)
  const month = words.findIndex((w) => MONTHS.includes(w.slice(0, 3)) && /^[a-z]+\.?$/.test(w))
  const nums = words.filter((w) => /^\d{1,4}(st|nd|rd|th)?$/.test(w)).map((w) => parseInt(w, 10))
  if (month >= 0 && nums.length >= 2) {
    const year = nums.find((n) => n >= 1990)
    const day = nums.find((n) => n >= 1 && n <= 31)
    if (year && day) return noonUtc(year, MONTHS.indexOf(words[month].slice(0, 3)) + 1, day)
  }
  return undefined
}

/** "yes", "y", "true", "x", "1", "sold" → true; "no", "", "false", "0" → false. */
export function parseYes(raw: string): boolean {
  return /^(y|yes|true|x|1|sold|✓|✔)$/i.test(raw.trim())
}
