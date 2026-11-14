// Transactional email through Resend (RESEND_API_KEY). From RESEND_FROM, which must be on a domain
// verified in Resend.
import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"

export const DEFAULT_FROM = "FlipLedger <noreply@emoneydeals.com>"
export const APP_URL = `https://${process.env.CANONICAL_HOST?.trim() || "profit.emoneydeals.com"}`

export class EmailError extends Error {}

export async function sendEmail(to: string, subject: string, html: string, unsubscribeUrl?: string) {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new EmailError("RESEND_API_KEY is not set")
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM?.trim() || DEFAULT_FROM,
      to: [to],
      subject,
      html,
      ...(unsubscribeUrl
        ? { headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }
        : {}),
    }),
  })
  if (!res.ok) throw new EmailError(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`)
}

export type EmailKind = "recap" | "tax"

function sign(userId: string, kind: EmailKind) {
  const secret = process.env.CRON_SECRET ?? ""
  return createHmac("sha256", secret).update(`unsub:${kind}:${userId}`).digest("base64url").slice(0, 32)
}

export function unsubscribeUrl(userId: string, kind: EmailKind) {
  return `${APP_URL}/api/email/unsubscribe?u=${userId}&k=${kind}&s=${sign(userId, kind)}`
}

export function verifyUnsubscribe(userId: string, kind: string, sig: string): kind is EmailKind {
  if (kind !== "recap" && kind !== "tax") return false
  if (!process.env.CRON_SECRET) return false
  const a = Buffer.from(sign(userId, kind))
  const b = Buffer.from(sig)
  return a.length === b.length && timingSafeEqual(a, b)
}
