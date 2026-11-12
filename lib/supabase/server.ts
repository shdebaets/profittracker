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

/** Whether the current user has the Cross-Lister (lib/whop/access.ts). Cached per request. */
export const canCrosslist = cache(async () => {
  const { userId, email } = await requireUser()
  return hasCrosslistAccess(userId, email)
})

export const CROSSLIST_LOCKED = "Cross-listing needs the FlipLedger Cross-Lister. Get it in Settings → Cross-Lister."

/**
 * requireUser plus the Cross-Lister. Every cross-listing server action and route goes through this;
 * it throws a UserError (shown as-is by fail()) when the user doesn't have it.
 */
export const requireCrosslister = cache(async () => {
  const user = await requireUser()
  if (!(await canCrosslist())) throw new UserError(CROSSLIST_LOCKED)
  return user
})
