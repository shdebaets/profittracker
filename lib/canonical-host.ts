// Sends visitors on an old production address (e.g. *.vercel.app) to CANONICAL_HOST.
// Off until CANONICAL_HOST is set, so it can ship before the domain's DNS is live.
// /api stays put: eBay webhooks, cron and photo links already point at the old host.
// Except the eBay OAuth callback: a person's browser lands there, and their session and the
// OAuth state cookie only exist on the canonical host.
const BROWSER_API_PATHS = ["/api/marketplaces/ebay/callback"]
export function canonicalRedirect(
  url: URL,
  host: string | null,
  canonicalHost: string | undefined,
  vercelEnv: string | undefined,
): URL | null {
  if (!canonicalHost || vercelEnv !== "production" || !host) return null
  if (host === canonicalHost || !host.endsWith(".vercel.app")) return null
  const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/")
  if (isApi && !BROWSER_API_PATHS.includes(url.pathname)) return null
  const target = new URL(url.pathname + url.search, `https://${canonicalHost}`)
  return target
}
