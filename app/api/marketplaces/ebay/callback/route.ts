import { cookies } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { STATE_COOKIE, exchangeCode, saveTokens } from "@/lib/marketplaces/ebay/oauth"
import { getIdentity, loadPolicies, saveSettings } from "@/lib/marketplaces/ebay/setup"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireUser } from "@/lib/supabase/server"
import type { EbaySettings } from "@/lib/types"

/** eBay redirects here (the RuName's accept URL) with ?code&state after the seller consents. */
export async function GET(request: NextRequest) {
  const { userId } = await requireUser()
  const params = request.nextUrl.searchParams
  const back = (status: string) => NextResponse.redirect(new URL(`/settings?ebay=${status}`, request.url))

  const jar = await cookies()
  const expected = jar.get(STATE_COOKIE)?.value
  jar.delete({ name: STATE_COOKIE, path: "/api/marketplaces/ebay" })
  const code = params.get("code")
  if (!code) return back("declined")
  if (!expected || params.get("state") !== expected) return back("state_mismatch")

  try {
    const tokens = await exchangeCode(code)
    const identity: { userId?: string; username?: string } = await getIdentity(tokens.access_token).catch(() => ({}))
    const admin = createAdminClient()
    // Reconnecting the same eBay account (e.g. to allow promoting) keeps its ZIP, location,
    // promote default and campaign. A different eBay account starts fresh.
    const { data: prev } = await admin
      .from("marketplace_accounts")
      .select("external_user_id, settings")
      .eq("user_id", userId)
      .eq("marketplace", "ebay")
      .maybeSingle()
    const sameAccount = !!prev && !!identity.userId && prev.external_user_id === identity.userId
    const base: EbaySettings = sameAccount ? { ...(prev.settings as EbaySettings), setupError: undefined } : {}
    await saveTokens(userId, tokens, identity)
    const settings = await loadPolicies(tokens.access_token, base).catch((e) => ({
      ...base,
      setupError: e instanceof Error ? e.message : "Couldn't load your eBay business policies",
    }))
    await saveSettings(admin, userId, settings)
  } catch (e) {
    console.error("eBay connect failed", e)
    return back("error")
  }
  return back("connected")
}
