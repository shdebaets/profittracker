import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { EbayPolicy, EbaySettings } from "@/lib/types"
import { EBAY_MARKETPLACE_ID, EbayError, ebayFetch } from "./client"

export async function getIdentity(token: string) {
  return ebayFetch<{ userId?: string; username?: string }>(token, "/commerce/identity/v1/user/", { host: "apiz" })
}

type Policies = NonNullable<EbaySettings["policies"]>

async function listPolicies(token: string): Promise<Policies> {
  const q = `?marketplace_id=${EBAY_MARKETPLACE_ID}`
  const [f, p, r] = await Promise.all([
    ebayFetch<{ fulfillmentPolicies?: { fulfillmentPolicyId: string; name: string }[] }>(token, `/sell/account/v1/fulfillment_policy${q}`),
    ebayFetch<{ paymentPolicies?: { paymentPolicyId: string; name: string }[] }>(token, `/sell/account/v1/payment_policy${q}`),
    ebayFetch<{ returnPolicies?: { returnPolicyId: string; name: string }[] }>(token, `/sell/account/v1/return_policy${q}`),
  ])
  const map = <T,>(xs: T[] | undefined, id: (x: T) => string, name: (x: T) => string): EbayPolicy[] =>
    (xs ?? []).map((x) => ({ id: id(x), name: name(x) }))
  return {
    fulfillment: map(f.fulfillmentPolicies, (x) => x.fulfillmentPolicyId, (x) => x.name),
    payment: map(p.paymentPolicies, (x) => x.paymentPolicyId, (x) => x.name),
    return: map(r.returnPolicies, (x) => x.returnPolicyId, (x) => x.name),
  }
}

/**
 * Load the seller's business policies (shipping, payment, returns), opting the
 * account into business policies first if needed, and pick defaults when
 * there's only one choice. Listing through the Inventory API requires them.
 */
export async function loadPolicies(token: string, current: EbaySettings): Promise<EbaySettings> {
  let policies: Policies
  try {
    policies = await listPolicies(token)
  } catch (e) {
    if (!(e instanceof EbayError) || e.status >= 500) throw e
    // Usually "not opted in to business policies" (error 20403). Opt in and retry once.
    await ebayFetch(token, "/sell/account/v1/program/opt_in", {
      body: { programType: "SELLING_POLICY_MANAGEMENT" },
    }).catch(() => {})
    policies = await listPolicies(token)
  }
  const pick = (list: EbayPolicy[], cur?: string) =>
    list.some((p) => p.id === cur) ? cur : list.length === 1 ? list[0].id : undefined
  return {
    ...current,
    policies,
    fulfillmentPolicyId: pick(policies.fulfillment, current.fulfillmentPolicyId),
    paymentPolicyId: pick(policies.payment, current.paymentPolicyId),
    returnPolicyId: pick(policies.return, current.returnPolicyId),
    setupError: undefined,
  }
}

/** Create (or reuse) the inventory location eBay ships items from. */
export async function ensureLocation(token: string, postalCode: string): Promise<string> {
  const key = `flipledger-${postalCode.replace(/\W/g, "")}`
  try {
    await ebayFetch(token, `/sell/inventory/v1/location/${key}`)
    return key
  } catch (e) {
    if (!(e instanceof EbayError) || e.status !== 404) throw e
  }
  await ebayFetch(token, `/sell/inventory/v1/location/${key}`, {
    body: {
      location: { address: { postalCode, country: "US" } },
      locationTypes: ["WAREHOUSE"],
      name: `Ships from ${postalCode}`,
      merchantLocationStatus: "ENABLED",
    },
  })
  return key
}

export async function saveSettings(admin: SupabaseClient, userId: string, settings: EbaySettings) {
  const { error } = await admin
    .from("marketplace_accounts")
    .update({ settings })
    .eq("user_id", userId)
    .eq("marketplace", "ebay")
  if (error) throw error
}
