export type Range = "all" | "today" | "week" | "month"

export const RANGE_LABELS: Record<Range, string> = {
  all: "All Time",
  today: "Today",
  week: "This Week",
  month: "This Month",
}

/** Start of the range in local time; null for "all". Week starts Sunday. */
export function rangeStart(range: Range, now = new Date()): Date | null {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (range) {
    case "all":
      return null
    case "today":
      return d
    case "week":
      d.setDate(d.getDate() - d.getDay())
      return d
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1)
  }
}

export function inRange(iso: string | null | undefined, range: Range, now = new Date()): boolean {
  if (range === "all") return true
  if (!iso) return false
  const start = rangeStart(range, now)!
  const t = new Date(iso)
  return t >= start && t <= now
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function relativeTime(iso: string, now = new Date()): string {
  const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000)
  if (s < 60) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return formatDate(iso)
}

/** Whole days from now until an ISO date (yyyy-mm-dd), negative if past. */
export function daysUntil(dateStr: string, now = new Date()): number {
  const [y, mo, da] = dateStr.split("-").map(Number)
  const target = new Date(y, mo - 1, da)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

export function addDays(days: number, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days)
  return toDateInput(d)
}

export function toDateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Timestamp for a yyyy-mm-dd picked in a date input: now if it's today, else local noon. */
export function dateInputToIso(dateStr: string, now = new Date()): string {
  if (!dateStr || dateStr === toDateInput(now)) return now.toISOString()
  return new Date(`${dateStr}T12:00:00`).toISOString()
}

/** "Sep 23 at 5:15 PM" */
export function formatDateAt(iso: string): string {
  const d = new Date(iso)
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  return `${day} at ${time}`
}
