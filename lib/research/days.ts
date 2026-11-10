// Every research "day" is an America/New_York calendar day, on the server and in the browser.
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })

export const dayET = (d: Date | string | number) => fmt.format(new Date(d))
export const todayET = (now = new Date()) => dayET(now)

/** Shift a YYYY-MM-DD calendar day by n days. */
export const addDays = (day: string, n: number) =>
  new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10)

/** The N full ET days ending yesterday: from <= day < to (to = today). */
export function windowET(n: number, now = new Date()) {
  const to = todayET(now)
  return { from: addDays(to, -n), to }
}
export const inWindow = (day: string, w: { from: string; to: string }) => day >= w.from && day < w.to

const stampFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
})
/** "Nov 10, 8:03 PM ET": same text on the server and in every browser (no hydration mismatch). */
export const stampET = (d: string | number | Date) => `${stampFmt.format(new Date(d))} ET`
