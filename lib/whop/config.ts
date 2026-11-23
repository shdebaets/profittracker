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
    /**
     * Products on another Whop business that include FlipLedger (e.g. "Accelerator Utilities" on eMoney Reselling).
     * Access only: billing and the cancel flow ignore them. Checked with `bundleApiKey`, a key on that business.
     */
    bundleProductIds: list(process.env.WHOP_BUNDLE_PRODUCT_IDS),
    bundleApiKey: process.env.WHOP_BUNDLE_API_KEY?.trim() ?? "",
    /**
     * The yearly plan's id, to tell monthly from yearly and retire a monthly plan once a yearly one is live.
     * There is no self-serve checkout: account managers sell FlipLedger and no price shows in the app (row 30, Nov 2026).
     */
    annualPlanId: process.env.WHOP_CROSSLIST_ANNUAL_PLAN_ID?.trim() ?? "",
    /** Emails that always get cross-listing, lowercased. */
    freeEmails: list(process.env.FLIPLEDGER_FREE_EMAILS).map((e) => e.toLowerCase()),
    /** Email/password and magic-link login: on for local QA, or until Whop sign-in is configured. */
    emailLogin: process.env.ALLOW_EMAIL_LOGIN === "1" || !clientId,
  }
}

export const MANAGE_BILLING_URL = "https://whop.com/@me/settings/orders"
