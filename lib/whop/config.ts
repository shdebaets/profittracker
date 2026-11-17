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
    /** Where "Get the Cross-Lister" sends people. */
    checkoutUrl: process.env.WHOP_CROSSLIST_CHECKOUT_URL?.trim() ?? "",
    /** Yearly plan checkout and id: the "switch to yearly" save offer in the cancel flow. */
    annualUrl: process.env.WHOP_CROSSLIST_ANNUAL_URL?.trim() ?? "",
    annualPlanId: process.env.WHOP_CROSSLIST_ANNUAL_PLAN_ID?.trim() ?? "",
    /**
     * The cancel flow's "take a break at half price" offer: three Whop promo codes, 50% off for 1, 2 and 3
     * months, in that order (Whop sets the length on the code). Empty hides the offer.
     */
    halfOffCodes: halfOffCodes(process.env.WHOP_HALF_OFF_CODES),
    /** Emails that always get cross-listing, lowercased. */
    freeEmails: list(process.env.FLIPLEDGER_FREE_EMAILS).map((e) => e.toLowerCase()),
    /** Email/password and magic-link login: on for local QA, or until Whop sign-in is configured. */
    emailLogin: process.env.ALLOW_EMAIL_LOGIN === "1" || !clientId,
  }
}

/** "1MO,2MO,3MO" → the code for each length, or [] unless all three are set. Pure. */
export function halfOffCodes(v: string | undefined): string[] {
  const codes = list(v)
  return codes.length === 3 ? codes : []
}

export const MANAGE_BILLING_URL = "https://whop.com/@me/settings/orders"
