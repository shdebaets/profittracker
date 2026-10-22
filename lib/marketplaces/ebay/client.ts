import "server-only"

// Thin fetch wrapper around eBay's REST APIs (sandbox or production via EBAY_ENV).

export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
]

export const EBAY_MARKETPLACE_ID = "EBAY_US"

export function ebayConfig() {
  const sandbox = (process.env.EBAY_ENV ?? "sandbox") !== "production"
  const clientId = process.env.EBAY_CLIENT_ID
  const clientSecret = process.env.EBAY_CLIENT_SECRET
  const ruName = process.env.EBAY_RUNAME
  return {
    sandbox,
    configured: !!(clientId && clientSecret && ruName),
    clientId: clientId ?? "",
    clientSecret: clientSecret ?? "",
    ruName: ruName ?? "",
    authUrl: sandbox ? "https://auth.sandbox.ebay.com/oauth2/authorize" : "https://auth.ebay.com/oauth2/authorize",
    api: sandbox ? "https://api.sandbox.ebay.com" : "https://api.ebay.com",
    apiz: sandbox ? "https://apiz.sandbox.ebay.com" : "https://apiz.ebay.com",
    listingUrl: (listingId: string) =>
      sandbox ? `https://sandbox.ebay.com/itm/${listingId}` : `https://www.ebay.com/itm/${listingId}`,
  }
}

export class EbayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: { errorId?: number; message?: string; longMessage?: string; parameters?: { name: string; value: string }[] }[] = [],
  ) {
    super(message)
  }
  has(errorId: number) {
    return this.errors.some((e) => e.errorId === errorId)
  }
  param(name: string) {
    for (const e of this.errors) for (const p of e.parameters ?? []) if (p.name === name) return p.value
    return undefined
  }
}

export async function ebayFetch<T = unknown>(
  token: string,
  path: string,
  init: { method?: string; body?: unknown; host?: "api" | "apiz" } = {},
): Promise<T> {
  const cfg = ebayConfig()
  const res = await fetch(`${init.host === "apiz" ? cfg.apiz : cfg.api}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      // Node's fetch defaults to "Accept-Language: *", which eBay rejects.
      "Accept-Language": "en-US",
      "Content-Language": "en-US",
      "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const errors = json.errors ?? (json.error ? [{ message: json.error_description ?? json.error }] : [])
    const msg = errors[0]?.longMessage || errors[0]?.message || `eBay request failed (${res.status})`
    throw new EbayError(msg, res.status, errors)
  }
  return json as T
}
