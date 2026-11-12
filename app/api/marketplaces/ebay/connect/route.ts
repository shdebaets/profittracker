import { randomBytes } from "node:crypto"
import { cookies } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { ebayConfig } from "@/lib/marketplaces/ebay/client"
import { STATE_COOKIE, authorizeUrl } from "@/lib/marketplaces/ebay/oauth"
import { canCrosslist, requireUser } from "@/lib/supabase/server"

/** Start eBay OAuth: remember a CSRF state, then send the user to eBay's consent page. */
export async function GET(request: NextRequest) {
  await requireUser()
  if (!(await canCrosslist())) return NextResponse.redirect(new URL("/crosslister", request.url))
  if (!ebayConfig().configured) {
    return NextResponse.redirect(new URL("/settings?ebay=not_configured", request.url))
  }
  const state = randomBytes(24).toString("base64url")
  ;(await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/api/marketplaces/ebay",
    maxAge: 600,
  })
  return NextResponse.redirect(authorizeUrl(state))
}
