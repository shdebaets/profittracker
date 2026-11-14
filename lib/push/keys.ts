// VAPID keys for web push, derived from CRON_SECRET so there's no extra secret to manage.
// Changing CRON_SECRET changes the keys; devices then re-subscribe the next time they open Settings.
import "server-only"
import { createECDH, createHmac } from "node:crypto"

let cached: { publicKey: string; privateKey: string } | null = null

export function vapidKeys() {
  if (cached) return cached
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return null
  const ecdh = createECDH("prime256v1")
  // A 32-byte HMAC is a valid P-256 private key except with negligible probability.
  ecdh.setPrivateKey(createHmac("sha256", secret).update("flipledger-vapid-v1").digest())
  cached = {
    publicKey: ecdh.getPublicKey().toString("base64url"),
    privateKey: ecdh.getPrivateKey().toString("base64url"),
  }
  return cached
}

export const VAPID_SUBJECT = "mailto:support@emoneydeals.com"
