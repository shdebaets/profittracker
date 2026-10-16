import "server-only"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { cache } from "react"
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
