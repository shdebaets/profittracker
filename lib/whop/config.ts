// Whop settings, read from the environment on each call so tests and preview deploys can change them.

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

export function whopConfig() {
  const clientId = process.env.WHOP_CLIENT_ID?.trim() ?? ""
  return {
    /** OAuth app id (`app_…`). Without it the app falls back to email login. */
    clientId,
    /** Server API key, used to check access. */
    apiKey: process.env.WHOP_API_KEY?.trim() ?? "",
    /** Products that unlock cross-listing. Empty means cross-listing is open to everyone. */
    productIds: list(process.env.WHOP_CROSSLIST_PRODUCT_IDS),
    /** Where "Get the Cross-Lister" sends people. */
    checkoutUrl: process.env.WHOP_CROSSLIST_CHECKOUT_URL?.trim() ?? "",
    /** Emails that always get cross-listing, lowercased. */
    freeEmails: list(process.env.FLIPLEDGER_FREE_EMAILS).map((e) => e.toLowerCase()),
    /** Email/password and magic-link login: on for local QA, or until Whop sign-in is configured. */
    emailLogin: process.env.ALLOW_EMAIL_LOGIN === "1" || !clientId,
  }
}

export const MANAGE_BILLING_URL = "https://whop.com/@me/settings/orders"
