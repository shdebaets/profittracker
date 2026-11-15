import "server-only"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { cache } from "react"
import { UserError } from "@/lib/errors"
import { hasCrosslistAccess } from "@/lib/whop/access"
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

/** Verified current user (per request). Redirects to /login when signed out. */
export const requireUser = cache(async () => {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims) redirect("/login")
  return { supabase, userId: claims.sub, email: (claims.email as string | undefined) ?? "" }
})

/** Whether the current user has an active FlipLedger membership (lib/whop/access.ts). Cached per request. */
export const isMember = cache(async () => {
  const { userId, email } = await requireUser()
  return hasCrosslistAccess(userId, email)
})

export const MEMBERSHIP_LOCKED =
  "Your FlipLedger membership isn't active, so you can view and export your history but not change it. Renew in Settings → Membership."

/**
 * requireUser plus an active membership. FlipLedger is paid: without one, people can only view and
 * export their history. Every server action that changes data goes through this; it throws a
 * UserError (shown as-is by fail()) for lapsed users. Account housekeeping (settings, push,
 * disconnecting eBay, billing) stays on requireUser.
 */
export const requireMember = cache(async () => {
  const user = await requireUser()
  if (!(await isMember())) throw new UserError(MEMBERSHIP_LOCKED)
  return user
})
