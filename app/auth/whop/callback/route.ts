import { cookies } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { reportError } from "@/lib/errors"
import { hasCrosslistAccess } from "@/lib/whop/access"
import { whopConfig } from "@/lib/whop/config"
import { CALLBACK_PATH, WHOP_COOKIE, decodePkce, exchangeCode, getUserInfo } from "@/lib/whop/oauth"
import { createClient } from "@/lib/supabase/server"
import { WhopSignInError, linkWhopToCurrentUser, signInWithWhopUser } from "@/lib/whop/signin"

// Relative Location so the redirect works from any host.
const go = (location: string) => new NextResponse(null, { status: 303, headers: { Location: location } })

/** Whop sends the user back here with ?code&state after they approve. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const jar = await cookies()
  const pkce = decodePkce(jar.get(WHOP_COOKIE)?.value)
  jar.delete({ name: WHOP_COOKIE, path: "/auth/whop" })

  // Already signed in (an older email-login account): link Whop to this account.
  const { data } = await (await createClient()).auth.getClaims()
  const current = data?.claims ? { userId: data.claims.sub, email: (data.claims.email as string | undefined) ?? "" } : null
  // Signed-in people can't see /login (the proxy sends them home), so their errors go to /crosslister.
  const failTo = (code: string) => go(current ? `/crosslister?whop_error=${code}` : `/login?error=${code}`)

  const code = params.get("code")
  if (params.get("error") === "access_denied") return current ? go("/crosslister") : go("/login")
  if (!code || !pkce || params.get("state") !== pkce.state) {
    console.error("[whop sign-in] bad callback", { hasCode: !!code, hasCookie: !!pkce, error: params.get("error"), description: params.get("error_description") })
    return failTo("whop")
  }

  try {
    const { clientId } = whopConfig()
    const redirectUri = new URL(CALLBACK_PATH, request.nextUrl.origin).toString()
    const token = await exchangeCode(clientId, redirectUri, code, pkce.verifier)
    const info = await getUserInfo(token)
    const linked = current ? await linkWhopToCurrentUser(info, current) : null
    const { userId, email } = linked ?? (await signInWithWhopUser(info))
    // Refresh the Cross-Lister answer now so a fresh purchase shows up right away.
    await hasCrosslistAccess(userId, email, true)
    return go(linked ? "/crosslister" : "/")
  } catch (e) {
    reportError(e, "whop sign-in")
    return failTo(e instanceof WhopSignInError ? e.code : "whop")
  }
}
