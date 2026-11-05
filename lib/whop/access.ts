// Who may use FlipLedger: allowlisted emails, or anyone Whop says has one of the configured products.
// Whop's answer is cached in whop_links for ACCESS_TTL_MS so a page load doesn't call Whop every time.
import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { whopConfig } from "./config"

export const ACCESS_TTL_MS = 10 * 60 * 1000

export type AccessRow = { whop_user_id: string; has_access: boolean; checked_at: string | null }

type Cfg = { productIds: string[]; freeEmails: string[] }

/**
 * Decide from what we already know. Returns true/false when settled, or "check" when Whop must be asked.
 * Pure, so it is unit-tested.
 */
export function decideCached(cfg: Cfg, email: string, row: AccessRow | null, now: number): boolean | "check" {
  if (email && cfg.freeEmails.includes(email.toLowerCase())) return true
  if (cfg.productIds.length === 0) return true // paywall off until a product is configured
  if (!row) return false // never signed in with Whop: nothing to check
  if (row.checked_at && now - Date.parse(row.checked_at) < ACCESS_TTL_MS) return row.has_access
  return "check"
}

/** Whop's answer for one product. `admin` (team members of the business) counts as access. */
type WhopAccess = { has_access?: boolean; access_level?: string }
export const grantsAccess = (a: WhopAccess) => a.has_access === true || a.access_level === "admin"

async function askWhop(apiKey: string, whopUserId: string, productIds: string[]): Promise<boolean> {
  for (const productId of productIds) {
    const res = await fetch(
      `https://api.whop.com/api/v1/users/${encodeURIComponent(whopUserId)}/access/${encodeURIComponent(productId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store" },
    )
    if (!res.ok) throw new Error(`Whop access check failed (${res.status}) for ${productId}`)
    if (grantsAccess((await res.json()) as WhopAccess)) return true
  }
  return false
}

/**
 * Whether this user may use the app. `force` skips the cache (the "I already bought it" button).
 * If Whop can't be reached, the last known answer stands so an outage doesn't lock paying users out.
 */
export async function hasPaidAccess(userId: string, email: string, force = false): Promise<boolean> {
  const cfg = whopConfig()
  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from("whop_links")
    .select("whop_user_id, has_access, checked_at")
    .eq("user_id", userId)
    .maybeSingle<AccessRow>()
  if (error) {
    console.error("[whop access] read failed", error)
    return false
  }
  const cached = decideCached(cfg, email, force && row ? { ...row, checked_at: null } : row, Date.now())
  if (cached !== "check" || !row) return cached === true

  if (!cfg.apiKey) {
    console.error("[whop access] WHOP_API_KEY is not set")
    return row.has_access
  }
  try {
    const hasAccess = await askWhop(cfg.apiKey, row.whop_user_id, cfg.productIds)
    await admin
      .from("whop_links")
      .update({ has_access: hasAccess, checked_at: new Date().toISOString() })
      .eq("user_id", userId)
    return hasAccess
  } catch (e) {
    console.error("[whop access] check failed; keeping last answer", e)
    return row.has_access
  }
}
