// Weekly alert digest: "N stale, M overpriced", as a push and an email, once per ISO week (sent
// from Monday; a run that ran out of time carries on the next day). Skipped when there's nothing
// to flag or the seller turned it off (settings.email_alerts). Runs from /api/cron/alerts.
import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { overpricedItems } from "@/lib/comps/overpriced"
import { formatCents } from "@/lib/money"
import { alertPush, alertSummary, alertUrl, hasAlerts, type AlertCounts } from "@/lib/push/alert-messages"
import { pushToUser } from "@/lib/push/send"
import { soldMedians } from "@/lib/sold-medians"
import { askingPrice, staleItems } from "@/lib/stale"
import { loadUserData } from "./jobs"
import { EMAIL_WORDMARK } from "./brand"
import { APP_URL, sendEmail, unsubscribeUrl } from "./send"

/** Monday (UTC) of the week `now` is in, as YYYY-MM-DD: the digest's once-a-week key. */
export function weekKey(now: Date) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** Send Monday to Wednesday, so a run cut short by the time limit finishes later that week. */
export const isDigestDay = (now: Date) => [1, 2, 3].includes(now.getUTCDay())

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

export function alertEmail(n: AlertCounts, top: { title: string; line: string }[], url: string, unsubscribe: string) {
  const rows = top
    .map((t) => `<tr><td style="padding:6px 0;color:#57534e">${esc(t.title.slice(0, 48))}</td><td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:700">${esc(t.line)}</td></tr>`)
    .join("")
  return {
    subject: `${n.stale} stale, ${n.overpriced} overpriced: time to reprice?`,
    html: `<!doctype html><html><body style="margin:0;background:#f5f4f0;font-family:Inter,Arial,sans-serif;color:#1c1917">
<div style="max-width:520px;padding:24px">
${EMAIL_WORDMARK}
<p style="font-size:20px;font-weight:700;margin:0">${esc(alertSummary(n))}.</p>
<p style="margin:8px 0 16px;color:#57534e">A price drop gets stale stock moving, and pricing near what it sells for gets it seen. One tap reprices them everywhere they're listed.</p>
${rows ? `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>` : ""}
<p style="margin:24px 0 0"><a href="${url}" style="display:inline-block;background:#f5982a;color:#1c1917;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:12px">Reprice them</a></p>
<p style="font-size:12px;color:#78716c;margin-top:32px">You get this weekly alert because you use FlipLedger. <a href="${unsubscribe}" style="color:#78716c">Unsubscribe</a></p>
</div></body></html>`,
  }
}

async function* allUsers(admin: SupabaseClient) {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    for (const u of data.users) if (u.email) yield { id: u.id, email: u.email }
    if (data.users.length < 200) return
  }
}

/** One seller's digest. Returns true when it went out. */
export async function sendAlertDigest(admin: SupabaseClient, user: { id: string; email: string }, now: Date) {
  const key = weekKey(now)
  const { data: sent } = await admin.from("email_log").select("user_id").eq("user_id", user.id).eq("kind", "alerts").eq("period_key", key).maybeSingle()
  if (sent) return false
  const data = await loadUserData(admin, user.id)
  if (data.settings.email_alerts === false) return false
  const staleDays = data.settings.stale_days
  const stale = staleItems(data.items, staleDays, now)
  const priced = data.items.filter((i) => i.status === "inventory" && askingPrice(i) != null)
  const over = overpricedItems(priced, await soldMedians(admin, priced, user.id))
  const n: AlertCounts = { stale: stale.length, overpriced: over.length, staleDays }
  if (!hasAlerts(n)) return false
  const top = [
    ...over.slice(0, 3).map((o) => ({ title: o.title, line: `${formatCents(o.priceCents)} vs ${formatCents(o.soldMedianCents)} sold` })),
    ...stale.slice(0, 3).map((i) => ({ title: i.title || `Item #${i.seq}`, line: `${staleDays}+ days` })),
  ].slice(0, 5)
  const unsub = unsubscribeUrl(user.id, "alerts")
  const mail = alertEmail(n, top, `${APP_URL}${alertUrl(n)}`, unsub)
  // Log first-writer-wins so an overlapping run never doubles up; a failed email doesn't block the push.
  await admin.from("email_log").upsert({ user_id: user.id, kind: "alerts", period_key: key })
  await sendEmail(user.email, mail.subject, mail.html, unsub).catch((e) => console.error("[alert digest email]", user.id, e))
  await pushToUser(admin, user.id, alertPush(n)).catch((e) => console.error("[alert digest push]", user.id, e))
  return true
}

export async function runAlertDigest(admin: SupabaseClient, now = new Date(), deadline = Date.now() + 240_000) {
  if (!isDigestDay(now)) return { sent: 0, failures: 0, skipped: "not a digest day" }
  let sent = 0, failures = 0, unfinished = false
  for await (const user of allUsers(admin)) {
    if (Date.now() > deadline) {
      unfinished = true
      break
    }
    try {
      if (await sendAlertDigest(admin, user, now)) sent++
    } catch (e) {
      failures++
      console.error("[alert digest] failed for", user.id, e)
    }
  }
  return { sent, failures, unfinished }
}
