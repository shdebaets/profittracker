// One place that turns any error into a sentence a reseller can act on.
// Errors we write for people are thrown as UserError and shown as-is; everything
// else (eBay, Supabase, network, validation, bugs) is translated here, and the
// technical original is logged so nothing is lost for debugging.
import { z } from "zod"

/** An error whose message is already written for the person using the app. */
export class UserError extends Error {
  readonly userFacing = true
  constructor(message: string) {
    super(message)
    this.name = "UserError"
  }
}

export const GENERIC_ERROR = "Something went wrong. Please try again."
const OUR_SIDE = "Something went wrong on our side. Please try again, and contact support if it keeps happening."
const OFFLINE = "Can't reach FlipLedger. Check your internet connection and try again."
const SESSION = "Your session has expired. Please sign in again."
const RECONNECT_EBAY = "Your eBay connection has expired. Reconnect eBay in Settings → Marketplaces."

type Obj = Record<string, unknown>
const isObj = (e: unknown): e is Obj => !!e && typeof e === "object"
const str = (v: unknown) => (typeof v === "string" ? v : "")

/** "item_specifics.Brand" / ["quantity"] → "the quantity" style field names for validation messages. */
function fieldName(path: PropertyKey[]): string {
  const last = String(path.filter((p) => typeof p === "string").at(-1) ?? "")
  const words = last
    .replace(/Cents$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .trim()
  return words ? `the ${words}` : "the form"
}

function fromZod(e: z.ZodError): string {
  const issue = e.issues[0]
  if (!issue) return "Some details aren't valid. Check the form and try again."
  // Our schemas use custom messages written for people; zod's defaults start like "Invalid input…" / "Too small…".
  if (!/^(invalid|too (small|big)|expected|unrecognized|required)/i.test(issue.message)) return issue.message
  return `Please check ${fieldName(issue.path)} and try again.`
}

function firstSentence(s: string) {
  const t = s.replace(/\s+/g, " ").trim()
  const m = t.match(/^(.+?[.!?])(\s|$)/)
  return (m ? m[1] : t).slice(0, 180)
}

function fromEbay(e: Obj): string {
  const status = Number(e.status) || 0
  const errors = Array.isArray(e.errors) ? (e.errors as Obj[]) : []
  const ids = errors.map((x) => Number(x.errorId))
  const text = [str(e.message), ...errors.map((x) => `${str(x.message)} ${str(x.longMessage)}`)].join(" ")

  if (status === 401 || ids.includes(1001) || /invalid_grant|refresh token|access token/i.test(text)) return RECONNECT_EBAY
  if (status === 429) return "eBay is busy right now. Wait a minute and try again."
  if (status >= 500 || ids.includes(25001)) return "eBay is having trouble right now. Try again in a few minutes."
  if (status === 403) return "eBay didn't allow that. Make sure your eBay account is set up to sell, then reconnect it in Settings."
  if (/create a seller'?s account|register as a seller|seller registration|before you can list this item/i.test(text))
    return "Your eBay account isn't set up to sell yet. On ebay.com, start a listing or open Seller Hub and finish eBay's seller setup (usually adding payout details), then try again."
  if (/picture|image|photo/i.test(text)) return "eBay couldn't use this item's photos. Try again, or remove and re-add the photos."
  if (/business polic|fulfillment polic|payment polic|return polic|not opted in/i.test(text))
    return "Check your eBay shipping, payment and return policies in Settings → Marketplaces."
  if (/location/i.test(text)) return "eBay needs your ship-from ZIP code. Add it in Settings → Marketplaces."
  if (/condition/i.test(text)) return "eBay doesn't allow that condition in this category. Pick a different condition."
  if (/item specific|aspect/i.test(text)) return `eBay needs more item specifics: ${firstSentence(errors[0] ? str(errors[0].longMessage) || str(errors[0].message) : str(e.message))}`
  if (/category/i.test(text)) return "eBay doesn't accept this category for this item. Pick a different category."
  if (/price/i.test(text)) return "eBay didn't accept the price. Check it and try again."
  if (/title/i.test(text)) return "eBay didn't accept the title. Shorten it or remove special characters."
  if (/header|content-type|content-language|accept-language|marketplace-id/i.test(text)) return OUR_SIDE
  const detail = firstSentence(str(errors[0]?.longMessage) || str(errors[0]?.message) || str(e.message))
  return detail ? `eBay couldn't do that: ${detail}` : "eBay couldn't do that. Please try again."
}

function fromSupabaseAuth(code: string, message: string): string | null {
  switch (code) {
    case "invalid_credentials":
      return "That email and password don't match. Try again, or use an email link."
    case "email_not_confirmed":
      return "Confirm your email first. Check your inbox for the link we sent."
    case "user_already_exists":
    case "email_exists":
      return "An account with this email already exists. Sign in instead."
    case "weak_password":
      return "Choose a stronger password (at least 6 characters)."
    case "email_address_invalid":
      return "That email address doesn't look right."
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many attempts. Wait a minute and try again."
    case "session_expired":
    case "session_not_found":
    case "refresh_token_not_found":
      return SESSION
  }
  if (/invalid login credentials/i.test(message)) return "That email and password don't match. Try again, or use an email link."
  if (/rate limit|only request this after/i.test(message)) return "Too many attempts. Wait a minute and try again."
  return null
}

function fromPostgrest(code: string, message: string): string | null {
  if (code === "PGRST116") return "We couldn't find that. It may have been deleted. Refresh and try again."
  if (code === "PGRST301" || /jwt expired/i.test(message)) return SESSION
  if (code === "23505") return "That already exists."
  if (code === "23503") return "This is linked to something that no longer exists. Refresh and try again."
  if (["23514", "23502", "22P02", "22003", "22001"].includes(code)) return "Some details aren't valid. Check the form and try again."
  if (code === "42501" || /row-level security|permission denied/i.test(message)) return "You don't have access to that. Try signing in again."
  if (/^(08|57|53)/.test(code)) return "The database is busy right now. Try again in a moment."
  return null
}

/** The message to show a person for any thrown value. */
export function friendlyError(e: unknown): string {
  if (e instanceof z.ZodError) return fromZod(e)
  if (e instanceof UserError || (isObj(e) && e.userFacing === true && str(e.message))) return str((e as Obj).message)
  if (!isObj(e)) return GENERIC_ERROR

  const name = str(e.name)
  const message = str(e.message)
  const code = str(e.code)

  if (name === "EbayError") return fromEbay(e)
  if (name === "AuthApiError" || name === "AuthError" || name.startsWith("Auth")) return fromSupabaseAuth(code, message) ?? GENERIC_ERROR
  if (name === "StorageError" || name === "StorageApiError" || name === "StorageUnknownError") {
    if (/not found/i.test(message)) return "That photo is no longer available. Remove it and add it again."
    if (/row-level security|unauthorized/i.test(message)) return "You don't have access to that photo."
    if (/size|too large|payload/i.test(message)) return "That photo is too large. Try a smaller one."
    return "Couldn't save the photo. Check your connection and try again."
  }
  if (/^(failed to fetch|fetch failed|load failed|networkerror)/i.test(message) || (name === "AbortError" && /network/i.test(message)))
    return OFFLINE
  if (name === "AbortError") return "That took too long. Please try again."
  if (name === "DOMException" || ["EncodingError", "InvalidStateError", "NotSupportedError"].includes(name))
    return "This photo couldn't be read. Try a JPG or PNG, or take the photo again."
  if (code) {
    const auth = fromSupabaseAuth(code, message)
    if (auth) return auth
    const db = fromPostgrest(code, message)
    if (db) return db
  }
  return OUR_SIDE
}

/** Server-side: translate, and log anything that wasn't already a friendly message. */
export function reportError(e: unknown, where?: string): string {
  const msg = friendlyError(e)
  if (!(e instanceof UserError) && !(e instanceof z.ZodError)) console.error(`[${where ?? "error"}]`, e)
  return msg
}
