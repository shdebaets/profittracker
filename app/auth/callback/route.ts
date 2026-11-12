import { NextResponse, type NextRequest } from "next/server"
import type { EmailOtpType } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { reportError } from "@/lib/errors"

// Relative Location so the redirect works from any host.
const to = (location: string) => new NextResponse(null, { status: 303, headers: { Location: location } })

// Handles magic-link / email-confirmation redirects from Supabase Auth.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get("code")
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null

  // Email links (token_hash) go to a page with a button: verifying here on GET
  // let mail scanners and link previews use up the one-time token before the
  // person's own click, which then showed "expired" even though it had worked.
  if (tokenHash && type) {
    const next = new URLSearchParams({ token_hash: tokenHash, type })
    return to(`/auth/confirm?${next}`)
  }

  const supabase = await createClient()

  let error: unknown = new Error("auth callback: no code or token_hash")
  if (code) error = (await supabase.auth.exchangeCodeForSession(code)).error
  if (!error) return to("/")

  // The link was already used (clicked twice, or opened by a mail app's preview)
  // but this browser is signed in, so there's nothing to fix.
  const { data } = await supabase.auth.getUser()
  if (data.user) return to("/")

  reportError(error, "auth callback")
  // A `code` link is Supabase's default (PKCE) email link. Supabase has already
  // confirmed the email before redirecting here; only the hand-off failed,
  // because the link was opened in a different browser than the one that signed up.
  return to(code ? "/login?error=browser" : "/login?error=link")
}
