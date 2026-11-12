export const EXISTING_ACCOUNT = "You already have an account with this email. Sign in with it instead."

/**
 * Supabase's signUp doesn't error for an email that's already registered (when email confirmation
 * is on); it returns an obfuscated user whose `identities` is empty. A real new user has one identity.
 */
export function isExistingAccount(user: { identities?: unknown[] | null } | null | undefined): boolean {
  return !!user && Array.isArray(user.identities) && user.identities.length === 0
}
