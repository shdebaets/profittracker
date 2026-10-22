import { createHmac, timingSafeEqual } from "node:crypto"

// Short, signed, expiring links to item photos, for marketplaces that fetch
// images by URL. eBay caps each picture URL at 500 characters (3,975 total),
// and Supabase signed URLs carry a ~400-character token, so we serve photos
// from /api/p/<expiry>/<signature>/<path> instead (about 150 characters).

export const PHOTO_LINK_TTL_SECONDS = 7 * 24 * 60 * 60
const PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/

function key(secret = process.env.TOKEN_ENCRYPTION_KEY) {
  if (!secret) throw new Error("TOKEN_ENCRYPTION_KEY is not set")
  return createHmac("sha256", secret).update("flipledger:photo-link:v1").digest()
}

function sign(path: string, exp: number, secret?: string) {
  return createHmac("sha256", key(secret)).update(`${exp}:${path}`).digest("base64url").slice(0, 22)
}

export function photoLink(origin: string, path: string, opts: { now?: number; secret?: string } = {}) {
  const exp = Math.floor((opts.now ?? Date.now()) / 1000) + PHOTO_LINK_TTL_SECONDS
  return `${origin}/api/p/${exp}/${sign(path, exp, opts.secret)}/${path}`
}

/** True when the link was signed by us, hasn't expired, and points at a photo path. */
export function verifyPhotoLink(expStr: string, sig: string, path: string, opts: { now?: number; secret?: string } = {}) {
  if (!/^\d{9,11}$/.test(expStr) || !PATH_RE.test(path)) return false
  const exp = Number(expStr)
  if (exp * 1000 < (opts.now ?? Date.now())) return false
  const want = Buffer.from(sign(path, exp, opts.secret))
  const got = Buffer.from(sig)
  return want.length === got.length && timingSafeEqual(want, got)
}
