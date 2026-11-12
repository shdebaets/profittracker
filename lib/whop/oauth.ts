// "Sign in with Whop": OAuth 2.1 + PKCE against api.whop.com (docs.whop.com/developer/guides/oauth).
import { createHash, randomBytes } from "node:crypto"

const OAUTH = "https://api.whop.com/oauth"
export const WHOP_COOKIE = "whop_oauth"
export const CALLBACK_PATH = "/auth/whop/callback"

export type PkceState = { state: string; verifier: string }

export function newPkce(): PkceState {
  return { state: randomBytes(24).toString("base64url"), verifier: randomBytes(32).toString("base64url") }
}

export const challengeFor = (verifier: string) => createHash("sha256").update(verifier).digest("base64url")

export function authorizeUrl(clientId: string, redirectUri: string, pkce: PkceState): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid profile email",
    state: pkce.state,
    code_challenge: challengeFor(pkce.verifier),
    code_challenge_method: "S256",
  })
  return `${OAUTH}/authorize?${params}`
}

/** Cookie value <-> PKCE state. Returns null for anything malformed. */
export const encodePkce = (p: PkceState) => `${p.state}.${p.verifier}`
export function decodePkce(v: string | undefined): PkceState | null {
  const [state, verifier, extra] = (v ?? "").split(".")
  return state && verifier && extra === undefined ? { state, verifier } : null
}

export class WhopAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WhopAuthError"
  }
}

export async function exchangeCode(clientId: string, redirectUri: string, code: string, verifier: string) {
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    }),
  })
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string }
  if (!res.ok || !body.access_token) {
    throw new WhopAuthError(`Whop token exchange failed (${res.status}): ${body.error ?? ""} ${body.error_description ?? ""}`)
  }
  return body.access_token
}

export type WhopUserInfo = {
  sub: string
  email?: string
  email_verified?: boolean
  preferred_username?: string
}

export async function getUserInfo(accessToken: string): Promise<WhopUserInfo> {
  const res = await fetch(`${OAUTH}/userinfo`, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new WhopAuthError(`Whop userinfo failed (${res.status})`)
  const info = (await res.json()) as WhopUserInfo
  if (!info.sub?.startsWith("user_")) throw new WhopAuthError("Whop userinfo had no user id")
  return info
}
