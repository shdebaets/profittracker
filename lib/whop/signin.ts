// Turns a Whop identity into a FlipLedger (Supabase) session. Supabase stays the session and
// RLS layer: every table is keyed by auth.users.id, so existing accounts keep their data.
import "server-only"
import { UserError } from "@/lib/errors"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import type { WhopUserInfo } from "./oauth"

/** Sign-in problems the person can fix; the login page shows a message for each code. */
export class WhopSignInError extends UserError {
  constructor(readonly code: "whop-email" | "whop-linked", message: string) {
    super(message)
  }
}

/**
 * Someone already signed in to FlipLedger (an older email-login account) connects their Whop
 * account. Links Whop to the current user instead of matching by email, so a different Whop
 * email can't create a second, empty account. Returns null when this Whop account already
 * belongs to another FlipLedger user; the caller then signs in as that user instead.
 */
export async function linkWhopToCurrentUser(
  info: WhopUserInfo,
  current: { userId: string; email: string },
): Promise<{ userId: string; email: string } | null> {
  const admin = createAdminClient()
  const { data: other, error } = await admin
    .from("whop_links")
    .select("user_id")
    .eq("whop_user_id", info.sub)
    .maybeSingle<{ user_id: string }>()
  if (error) throw error
  if (other && other.user_id !== current.userId) return null

  const { data: mine } = await admin
    .from("whop_links")
    .select("whop_user_id")
    .eq("user_id", current.userId)
    .maybeSingle<{ whop_user_id: string }>()
  if (mine && mine.whop_user_id !== info.sub) {
    throw new WhopSignInError("whop-linked", "This FlipLedger account is already linked to a different Whop account.")
  }
  const { error: upErr } = await admin.from("whop_links").upsert(
    { user_id: current.userId, whop_user_id: info.sub, whop_username: info.preferred_username ?? null },
    { onConflict: "user_id" },
  )
  if (upErr) throw upErr
  return current
}

/**
 * Find or create the Supabase user for this Whop user and sign them in (sets the auth cookies).
 * Matching order: an existing whop_links row, else the verified Whop email (which is how
 * accounts made with email login are kept), else a new user.
 */
export async function signInWithWhopUser(info: WhopUserInfo): Promise<{ userId: string; email: string }> {
  const admin = createAdminClient()

  const { data: link, error: linkErr } = await admin
    .from("whop_links")
    .select("user_id")
    .eq("whop_user_id", info.sub)
    .maybeSingle<{ user_id: string }>()
  if (linkErr) throw linkErr

  let email: string
  if (link) {
    const { data, error } = await admin.auth.admin.getUserById(link.user_id)
    if (error || !data.user?.email) throw error ?? new Error("Linked FlipLedger user has no email")
    email = data.user.email
  } else {
    if (!info.email || !info.email_verified) {
      throw new WhopSignInError("whop-email", "Verify your email on Whop first, then sign in again.")
    }
    email = info.email.toLowerCase()
  }

  // Creates the user when the email is new; returns a one-time token we redeem below.
  const { data: gen, error: genErr } = await admin.auth.admin.generateLink({ type: "magiclink", email })
  if (genErr) throw genErr
  const userId = gen.user.id

  if (!link) {
    const { data: existing } = await admin
      .from("whop_links")
      .select("whop_user_id")
      .eq("user_id", userId)
      .maybeSingle<{ whop_user_id: string }>()
    if (existing && existing.whop_user_id !== info.sub) {
      throw new WhopSignInError("whop-linked", "This email's FlipLedger account is already linked to a different Whop account.")
    }
  }
  const { error: upErr } = await admin.from("whop_links").upsert(
    { user_id: userId, whop_user_id: info.sub, whop_username: info.preferred_username ?? null },
    { onConflict: "user_id" },
  )
  if (upErr) throw upErr

  const supabase = await createClient()
  const { error: otpErr } = await supabase.auth.verifyOtp({ token_hash: gen.properties.hashed_token, type: "magiclink" })
  if (otpErr) throw otpErr

  return { userId, email }
}
