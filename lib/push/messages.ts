// Push notification copy. Pure.
import { formatCents } from "@/lib/money"
import { dayWord, type ReturnDue } from "@/lib/returns/reminders"

/** `weekKey` (see `recapWeekKey`) makes the tap open the week the push described, not whatever "this week" is by then. */
export function recapPush(n: { profit: number; itemsSold: number; miles: number; mileageWriteOff: number }, weekKey?: string) {
  const miles = n.miles > 0 ? `, ${Math.round(n.miles * 10) / 10} mi logged (${formatCents(n.mileageWriteOff)} write-off)` : ""
  return {
    title: "Your week on FlipLedger",
    body: `This week: ${formatCents(n.profit)} profit, ${n.itemsSold} ${n.itemsSold === 1 ? "item" : "items"} sold${miles}.`,
    url: weekKey ? `/recap?week=${weekKey}` : "/recap",
    tag: "recap",
  }
}

export function tripPush(miles: number, deductionCents: number) {
  return {
    title: "Trip logged",
    body: `${Math.round(miles * 10) / 10} mi logged, ${formatCents(deductionCents)} write-off.`,
    url: "/expenses",
    tag: "trip",
  }
}

/** The quarterly estimated tax reminder, sent next to the email. */
export function taxPush(q: { n: number; due: Date }, setAsideCents: number, daysLeft: number) {
  const due = q.due.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  const when = daysLeft <= 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`
  return {
    title: `Q${q.n} estimated tax due ${when}`,
    body: `Due ${due}. Set aside about ${formatCents(setAsideCents)}. Estimate only, not tax advice.`,
    url: "/taxes",
    tag: "tax",
  }
}

/** Return windows closing in 3 days or 1 day. `due` is soonest first and never empty. */
export function returnsPush(due: ReturnDue[]) {
  const [first, ...rest] = due
  const more = rest.length ? `, +${rest.length} more` : ""
  return {
    title: due.length === 1 ? "Return window closing" : `${due.length} return windows closing`,
    body: `${first.title} (${dayWord(first.daysLeft)} left)${more}.`,
    url: "/inventory?filter=returns",
    tag: "returns",
  }
}
