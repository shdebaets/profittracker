// Sends web push notifications to every device a user turned them on for.
import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import webpush from "web-push"
import { VAPID_SUBJECT, vapidKeys } from "./keys"

export type PushMessage = { title: string; body: string; url?: string; tag?: string }

/** Returns how many devices got it. Dead subscriptions (404/410) are deleted. Needs the admin client. */
export async function pushToUser(admin: SupabaseClient, userId: string, msg: PushMessage): Promise<number> {
  const keys = vapidKeys()
  if (!keys) return 0
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId)
  if (error) throw error
  let sent = 0
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(msg),
        { vapidDetails: { subject: VAPID_SUBJECT, publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 60 * 60 * 24 },
      )
      sent++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("id", s.id)
      else console.error("[push] send failed", status, e)
    }
  }
  return sent
}
