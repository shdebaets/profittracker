import "server-only"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { cache } from "react"
import { hasPaidAccess } from "@/lib/whop/access"
import { SUPABASE_KEY, SUPABASE_URL } from "./env"

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(toSet) {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Called from a Server Component; proxy.ts refreshes the session instead.
        }
      },
    },
  })
}

/**
 * Verified signed-in user (per request), WITHOUT the paid-access check. Redirects to /login when
 * signed out. Only for pages a non-paying user must reach (/subscribe); everything else uses requireUser.
 */
export const getSessionUser = cache(async () => {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims) redirect("/login")
  return { supabase, userId: claims.sub, email: (claims.email as string | undefined) ?? "" }
})

/**
 * Verified signed-in user with paid access (per request). Redirects to /login when signed out
 * and to /subscribe without a Whop membership (lib/whop/access.ts). Every page, server action and
 * data read goes through this, so it is the paywall.
 */
export const requireUser = cache(async () => {
  const user = await getSessionUser()
  if (!(await hasPaidAccess(user.userId, user.email))) redirect("/subscribe")
  return user
})
