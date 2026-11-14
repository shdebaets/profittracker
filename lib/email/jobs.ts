// The daily email job: Sunday recaps and quarterly tax reminders (7 days and 1 day before each due
// date). `email_log` makes every send idempotent, so re-running the cron never double-sends.
import "server-only"
import { recapPush } from "@/lib/push/messages"
import { pushToUser } from "@/lib/push/send"
import type { SupabaseClient } from "@supabase/supabase-js"
import { DEFAULT_SETTINGS } from "@/lib/data-defaults"
import { lastTwoWeeks, quietWeek, weekNumbers } from "@/lib/recap"
import { daysBetween, estimatedTax, nextQuarter, periodReport } from "@/lib/tax"
import type { Expense, Item, Settings, Subscription } from "@/lib/types"
import { APP_URL, sendEmail, unsubscribeUrl } from "./send"
import { recapEmail, recapSubject, taxReminderEmail } from "./templates"

type UserData = { items: Item[]; expenses: Expense[]; subs: Subscription[]; settings: Settings }

export async function loadUserData(admin: SupabaseClient, userId: string): Promise<UserData> {
  const [items, expenses, subs, settings] = await Promise.all([
    admin.from("items").select("*, listings:marketplace_listings(*)").eq("user_id", userId),
    admin.from("expenses").select("*").eq("user_id", userId),
    admin.from("subscriptions").select("*").eq("user_id", userId),
    admin.from("settings").select("*").eq("user_id", userId).maybeSingle(),
  ])
  for (const r of [items, expenses, subs, settings]) if (r.error) throw r.error
  const s = settings.data as UserData["settings"] | null
  return {
    items: (items.data ?? []) as Item[],
    expenses: (expenses.data ?? []) as Expense[],
    subs: (subs.data ?? []) as Subscription[],
    settings: s
      ? { ...s, tax_bracket: Number(s.tax_bracket) }
      : DEFAULT_SETTINGS,
  }
}

async function alreadySent(admin: SupabaseClient, userId: string, kind: string, key: string) {
  const { data } = await admin.from("email_log").select("user_id").eq("user_id", userId).eq("kind", kind).eq("period_key", key).maybeSingle()
  return Boolean(data)
}

async function logSent(admin: SupabaseClient, userId: string, kind: string, key: string) {
  await admin.from("email_log").upsert({ user_id: userId, kind, period_key: key })
}

/** Returns true if an email went out. `force` (the Settings test button) skips the quiet-week and once-only checks. */
export async function sendRecap(admin: SupabaseClient, user: { id: string; email: string }, data: UserData, now: Date, force = false) {
  const { week, prev } = lastTwoWeeks(now)
  const key = week.to.toISOString().slice(0, 10)
  if (!force && (await alreadySent(admin, user.id, "recap", key))) return false
  const n = weekNumbers(data.items, data.expenses, week)
  const p = weekNumbers(data.items, data.expenses, prev)
  if (!force && quietWeek(n, p)) return false
  await sendEmail(user.email, recapSubject(n), recapEmail(n, p, `${APP_URL}/recap`, unsubscribeUrl(user.id, "recap")), unsubscribeUrl(user.id, "recap"))
  // Same recap as a push on every device that turned notifications on. A push failure never blocks the email.
  await pushToUser(admin, user.id, recapPush(n)).catch((e) => console.error("[recap push]", user.id, e))
  if (!force) await logSent(admin, user.id, "recap", key)
  return true
}

export const TAX_REMINDER_DAYS = [7, 1]

export async function sendTaxReminder(admin: SupabaseClient, user: { id: string; email: string }, data: UserData, now: Date, force = false) {
  const q = nextQuarter(now)
  const days = daysBetween(now, q.due)
  if (!force && !TAX_REMINDER_DAYS.includes(days)) return false
  const key = `${q.year}-Q${q.n}-${days}`
  if (!force && (await alreadySent(admin, user.id, "tax", key))) return false
  const r = periodReport(data.items, data.expenses, data.subs, q.period, now)
  const setAside = estimatedTax(r.netProfit, data.settings.tax_bracket).total
  if (!force && setAside <= 0) return false
  const mail = taxReminderEmail(q, r.netProfit, setAside, days, `${APP_URL}/taxes`, unsubscribeUrl(user.id, "tax"))
  await sendEmail(user.email, mail.subject, mail.html, unsubscribeUrl(user.id, "tax"))
  if (!force) await logSent(admin, user.id, "tax", key)
  return true
}

/** Every user, paged. */
async function* allUsers(admin: SupabaseClient) {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    for (const u of data.users) if (u.email) yield { id: u.id, email: u.email }
    if (data.users.length < 200) return
  }
}

export async function runDailyEmails(admin: SupabaseClient, now = new Date()) {
  const sunday = now.getUTCDay() === 0
  let recaps = 0, reminders = 0, failures = 0
  for await (const user of allUsers(admin)) {
    try {
      const data = await loadUserData(admin, user.id)
      if (sunday && data.settings.email_recap && (await sendRecap(admin, user, data, now))) recaps++
      if (data.settings.email_tax_reminders && (await sendTaxReminder(admin, user, data, now))) reminders++
    } catch (e) {
      failures++
      console.error("[daily emails] failed for", user.id, e)
    }
  }
  return { recaps, reminders, failures }
}
