import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env"

// Machine endpoints authenticate themselves (CRON_SECRET / eBay signature / signed photo links).
const PUBLIC_PATHS = ["/login", "/auth", "/api/cron", "/api/marketplaces/ebay/account-deletion", "/api/p"]

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(toSet, headers) {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v))
      },
    },
  })

  // Refreshes the session cookie if needed; must run before any early return.
  const { data } = await supabase.auth.getClaims()
  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.search = ""
    return NextResponse.redirect(url)
  }
  if (data?.claims && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url))
  }
  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|icons/|.*\\.(?:png|svg|jpg|webp|ico)$).*)"],
}
