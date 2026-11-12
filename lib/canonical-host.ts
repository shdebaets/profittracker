// Sends visitors on an old production address (e.g. *.vercel.app) to CANONICAL_HOST.
// Off until CANONICAL_HOST is set, so it can ship before the domain's DNS is live.
// /api stays put: eBay webhooks, cron and photo links already point at the old host.
export function canonicalRedirect(
  url: URL,
  host: string | null,
  canonicalHost: string | undefined,
  vercelEnv: string | undefined,
): URL | null {
  if (!canonicalHost || vercelEnv !== "production" || !host) return null
  if (host === canonicalHost || !host.endsWith(".vercel.app")) return null
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return null
  const target = new URL(url.pathname + url.search, `https://${canonicalHost}`)
  return target
}
