// The daily email + push job: Sunday recaps and quarterly tax reminders (the week before and the day
// before each due date). `email_log` makes every send idempotent, so re-running the cron never double-sends.
import "server-only"
import { recapPush, taxPush } from "@/lib/push/messages"
import { pushToUser } from "@/lib/push/send"
import type { SupabaseClient } from "@supabase/supabase-js"
import { DEFAULT_SETTINGS } from "@/lib/data-defaults"
import { quietWeek, recapWeekKey, weekNumbers, weeksEnding } from "@/lib/recap"
import { daysBetween, estimatedTax, nextQuarter, periodReport, taxReminderWindow } from "@/lib/tax"
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

export type Channels = { email: boolean; push: boolean }
type Sent = { email: boolean; push: boolean }

/**
 * Sends each channel that's switched on and hasn't gone out yet, each logged on its own in `email_log`
 * (`<kind>` for the email, `<kind>-push` for the push), so a failed email never holds back the push
 * or the other way round. A push to a seller with no devices isn't logged. An email failure is thrown
 * after the push has had its turn, so the cron still counts it.
 */
async function sendBoth(
  admin: SupabaseClient,
  userId: string,
  kind: string,
  key: string,
  channels: Channels,
  force: boolean,
  send: { email: () => Promise<void>; push: () => Promise<number> },
): Promise<Sent> {
  const sent: Sent = { email: false, push: false }
  let emailError: unknown = null
  if (channels.email && (force || !(await alreadySent(admin, userId, kind, key)))) {
    try {
      await send.email()
      sent.email = true
      if (!force) await logSent(admin, userId, kind, key)
    } catch (e) {
      emailError = e
    }
  }
  if (channels.push && (force || !(await alreadySent(admin, userId, `${kind}-push`, key)))) {
    try {
      if ((await send.push()) > 0) {
        sent.push = true
        if (!force) await logSent(admin, userId, `${kind}-push`, key)
      }
    } catch (e) {
      console.error(`[${kind} push]`, userId, e)
    }
  }
  if (emailError) throw emailError
  return sent
}

/**
 * The Sunday recap for the week ending at the latest week end (`recapWeekKey`). `force` (the Settings
 * test button) skips the quiet-week and once-only checks.
 */
export async function sendRecap(
  admin: SupabaseClient,
  user: { id: string; email: string },
  data: UserData,
  now: Date,
  channels: Channels,
  force = false,
): Promise<Sent> {
  const key = recapWeekKey(now)
  const { week, prev } = weeksEnding(key)!
  const n = weekNumbers(data.items, data.expenses, week)
  const p = weekNumbers(data.items, data.expenses, prev)
  if (!force && quietWeek(n, p)) return { email: false, push: false }
  const url = `${APP_URL}/recap?week=${key}`
  return sendBoth(admin, user.id, "recap", key, channels, force, {
    email: () => sendEmail(user.email, recapSubject(n), recapEmail(n, p, url, unsubscribeUrl(user.id, "recap")), unsubscribeUrl(user.id, "recap")),
    push: () => pushToUser(admin, user.id, recapPush(n, key)),
  })
}

export async function sendTaxReminder(
  admin: SupabaseClient,
  user: { id: string; email: string },
  data: UserData,
  now: Date,
  channels: Channels,
  force = false,
): Promise<Sent> {
  const q = nextQuarter(now)
  const days = daysBetween(now, q.due)
  const window = taxReminderWindow(days)
  if (!force && !window) return { email: false, push: false }
  const r = periodReport(data.items, data.expenses, data.subs, q.period, now)
  const setAside = estimatedTax(r.netProfit, data.settings.tax_bracket).total
  if (!force && setAside <= 0) return { email: false, push: false }
  // One key per window, so the week-before and day-before reminders each go out once.
  const key = `${q.year}-Q${q.n}-${window ?? days}`
  return sendBoth(admin, user.id, "tax", key, channels, force, {
    email: async () => {
      const mail = taxReminderEmail(q, r.netProfit, setAside, days, `${APP_URL}/taxes`, unsubscribeUrl(user.id, "tax"))
      await sendEmail(user.email, mail.subject, mail.html, unsubscribeUrl(user.id, "tax"))
    },
    push: () => pushToUser(admin, user.id, taxPush(q, setAside, days)),
  })
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
  let recaps = 0, reminders = 0, recapPushes = 0, taxPushes = 0, failures = 0
  for await (const user of allUsers(admin)) {
    try {
      const data = await loadUserData(admin, user.id)
      const st = data.settings
      if (sunday) {
        const r = await sendRecap(admin, user, data, now, { email: st.email_recap, push: st.push_recap })
        if (r.email) recaps++
        if (r.push) recapPushes++
      }
      const t = await sendTaxReminder(admin, user, data, now, { email: st.email_tax_reminders, push: st.push_tax_reminders })
      if (t.email) reminders++
      if (t.push) taxPushes++
    } catch (e) {
      failures++
      console.error("[daily emails] failed for", user.id, e)
    }
  }
  return { recaps, reminders, recapPushes, taxPushes, failures }
}
