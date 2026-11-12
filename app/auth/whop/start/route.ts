import { cookies } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { whopConfig } from "@/lib/whop/config"
import { CALLBACK_PATH, WHOP_COOKIE, authorizeUrl, encodePkce, newPkce } from "@/lib/whop/oauth"

/** Start "Sign in with Whop": remember PKCE state in a cookie, then send the user to Whop. */
export async function GET(request: NextRequest) {
  const { clientId } = whopConfig()
  if (!clientId) return new NextResponse(null, { status: 303, headers: { Location: "/login" } })

  const pkce = newPkce()
  ;(await cookies()).set(WHOP_COOKIE, encodePkce(pkce), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/auth/whop",
    maxAge: 600,
  })
  return NextResponse.redirect(authorizeUrl(clientId, new URL(CALLBACK_PATH, request.nextUrl.origin).toString(), pkce))
}
