import { cookies } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { STATE_COOKIE, exchangeCode, saveTokens } from "@/lib/marketplaces/ebay/oauth"
import { getIdentity, loadPolicies, saveSettings } from "@/lib/marketplaces/ebay/setup"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireUser } from "@/lib/supabase/server"

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
    const identity = await getIdentity(tokens.access_token).catch(() => ({}))
    await saveTokens(userId, tokens, identity)
    const settings = await loadPolicies(tokens.access_token, {}).catch((e) => ({
      setupError: e instanceof Error ? e.message : "Couldn't load your eBay business policies",
    }))
    await saveSettings(createAdminClient(), userId, settings)
  } catch (e) {
    console.error("eBay connect failed", e)
    return back("error")
  }
  return back("connected")
}
