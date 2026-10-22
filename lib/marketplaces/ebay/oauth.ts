import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { decrypt, encrypt } from "@/lib/crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import type { EbaySettings } from "@/lib/types"
import { EBAY_SCOPES, EbayError, ebayConfig } from "./client"

export const STATE_COOKIE = "ebay_oauth_state"

type TokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  refresh_token_expires_in?: number
}

export function authorizeUrl(state: string) {
  const cfg = ebayConfig()
  const url = new URL(cfg.authUrl)
  url.searchParams.set("client_id", cfg.clientId)
  url.searchParams.set("redirect_uri", cfg.ruName)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", EBAY_SCOPES.join(" "))
  url.searchParams.set("state", state)
  return url.toString()
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const cfg = ebayConfig()
  const res = await fetch(`${cfg.api}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept-Language": "en-US",
    },
    body: new URLSearchParams(body),
    cache: "no-store",
  })
  const json = await res.json()
  if (!res.ok) throw new EbayError(json.error_description ?? json.error ?? "eBay sign-in failed", res.status)
  return json
}

export function exchangeCode(code: string) {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: ebayConfig().ruName })
}

let appToken: { token: string; expires: number } | null = null

/** Application (client-credentials) token, for calls not tied to a seller. */
export async function getAppToken() {
  if (appToken && appToken.expires > Date.now() + 60_000) return appToken.token
  const t = await tokenRequest({ grant_type: "client_credentials", scope: EBAY_SCOPES[0] })
  appToken = { token: t.access_token, expires: Date.now() + t.expires_in * 1000 }
  return t.access_token
}

export type EbayAccount = {
  id: string
  user_id: string
  external_user_id: string | null
  settings: EbaySettings
  last_synced_at: string | null
  created_at: string
}

/** Save tokens from a code exchange (encrypted at rest). */
export async function saveTokens(
  userId: string,
  t: TokenResponse,
  identity: { userId?: string; username?: string },
) {
  const admin = createAdminClient()
  const now = Date.now()
  const { error } = await admin.from("marketplace_accounts").upsert(
    {
      user_id: userId,
      marketplace: "ebay",
      external_user_id: identity.userId ?? null,
      external_username: identity.username ?? null,
      access_token_enc: encrypt(t.access_token),
      refresh_token_enc: encrypt(t.refresh_token ?? ""),
      access_expires_at: new Date(now + t.expires_in * 1000).toISOString(),
      refresh_expires_at: t.refresh_token_expires_in
        ? new Date(now + t.refresh_token_expires_in * 1000).toISOString()
        : null,
    },
    { onConflict: "user_id,marketplace" },
  )
  if (error) throw error
}

/**
 * A valid seller access token for this user, refreshing it (2h lifetime) when
 * needed. Returns null when the user hasn't connected eBay.
 */
export async function getUserToken(
  userId: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<{ token: string; account: EbayAccount } | null> {
  const { data: row, error } = await admin
    .from("marketplace_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("marketplace", "ebay")
    .maybeSingle()
  if (error) throw error
  if (!row) return null
  const account: EbayAccount = row

  if (new Date(row.access_expires_at).getTime() > Date.now() + 120_000) {
    return { token: decrypt(row.access_token_enc), account }
  }
  const t = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: decrypt(row.refresh_token_enc),
    scope: EBAY_SCOPES.join(" "),
  }).catch((e) => {
    throw new Error(`eBay connection expired, reconnect it in Settings (${e instanceof Error ? e.message : e})`)
  })
  await admin
    .from("marketplace_accounts")
    .update({
      access_token_enc: encrypt(t.access_token),
      access_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    })
    .eq("id", row.id)
  return { token: t.access_token, account }
}

export async function requireUserToken(userId: string, admin?: SupabaseClient) {
  const t = await getUserToken(userId, admin)
  if (!t) throw new Error("Connect your eBay account in Settings first")
  return t
}
