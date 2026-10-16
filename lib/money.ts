const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

/** Format integer cents as USD, e.g. 123456 -> "$1,234.56". */
export function formatCents(cents: number): string {
  return usd.format(cents / 100)
}

/** Signed format, e.g. "+$12.00" / "-$3.50". */
export function formatSignedCents(cents: number): string {
  return (cents >= 0 ? "+" : "-") + usd.format(Math.abs(cents) / 100)
}

/** Parse a user-entered dollar string ("$1,234.5") into integer cents. Invalid -> 0. */
export function toCents(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === "") return 0
  const n = typeof input === "number" ? input : Number(String(input).replace(/[$,\s]/g, ""))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function centsToInput(cents: number | null | undefined): string {
  if (!cents) return ""
  return (cents / 100).toFixed(2)
}

export function formatPct(ratio: number): string {
  return `${ratio >= 0 ? "+" : ""}${(ratio * 100).toFixed(1)}%`
}
