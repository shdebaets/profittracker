import "server-only"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { SUPABASE_URL } from "./env"

let admin: SupabaseClient | null = null

/**
 * Service-role client: bypasses RLS. Only for code with no user session
 * (cron, marketplace webhooks) and for the token columns of marketplace_accounts.
 */
export function createAdminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set")
  admin ??= createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return admin
}
