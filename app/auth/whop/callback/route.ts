import { cookies } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { reportError } from "@/lib/errors"
import { hasCrosslistAccess } from "@/lib/whop/access"
import { whopConfig } from "@/lib/whop/config"
import { CALLBACK_PATH, WHOP_COOKIE, decodePkce, exchangeCode, getUserInfo } from "@/lib/whop/oauth"
import { WhopSignInError, signInWithWhopUser } from "@/lib/whop/signin"

// Relative Location so the redirect works from any host.
const go = (location: string) => new NextResponse(null, { status: 303, headers: { Location: location } })

/** Whop sends the user back here with ?code&state after they approve. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const jar = await cookies()
  const pkce = decodePkce(jar.get(WHOP_COOKIE)?.value)
  jar.delete({ name: WHOP_COOKIE, path: "/auth/whop" })

  const code = params.get("code")
  if (params.get("error") === "access_denied") return go("/login")
  if (!code || !pkce || params.get("state") !== pkce.state) return go("/login?error=whop")

  try {
    const { clientId } = whopConfig()
    const redirectUri = new URL(CALLBACK_PATH, request.nextUrl.origin).toString()
    const token = await exchangeCode(clientId, redirectUri, code, pkce.verifier)
    const info = await getUserInfo(token)
    const { userId, email } = await signInWithWhopUser(info)
    // Refresh the Cross-Lister answer now so a fresh purchase shows up right away.
    await hasCrosslistAccess(userId, email, true)
    return go("/")
  } catch (e) {
    reportError(e, "whop sign-in")
    return go(`/login?error=${e instanceof WhopSignInError ? e.code : "whop"}`)
  }
}
