import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { EbayPolicy, EbaySettings } from "@/lib/types"
import { EBAY_MARKETPLACE_ID, EbayError, ebayFetch } from "./client"
import { missingPolicies, POLICY_NAMES, policyBodies, type PolicyChoices, type PolicyType } from "./mapping"

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

const POLICY_PATH: Record<PolicyType, string> = {
  fulfillment: "/sell/account/v1/fulfillment_policy",
  payment: "/sell/account/v1/payment_policy",
  return: "/sell/account/v1/return_policy",
}

/**
 * Create starter policies for the types the seller hasn't picked, then select them.
 * They're ordinary policies on the seller's eBay account, so they can edit them there.
 * A policy we already created (same name) is reused, so tapping twice is harmless.
 */
export async function createPolicies(token: string, current: EbaySettings, choices: PolicyChoices): Promise<EbaySettings> {
  const loaded = await loadPolicies(token, current) // also opts the account in to business policies
  const missing = missingPolicies(loaded)
  const bodies = policyBodies(choices)
  const ours = (t: PolicyType, p: Policies) => p[t].find((x) => x.name === POLICY_NAMES[t])?.id
  const created: Partial<Record<PolicyType, string>> = {}

  const results = await Promise.allSettled(
    missing.map(async (t) => {
      created[t] =
        ours(t, loaded.policies!) ??
        (await ebayFetch<Record<string, string>>(token, POLICY_PATH[t], {
          body: { ...bodies[t], marketplaceId: EBAY_MARKETPLACE_ID },
        }))[`${t}PolicyId`]
    }),
  )
  const failed = results.find((r) => r.status === "rejected")
  if (failed) {
    // A duplicate name (e.g. a second tap racing the first) still leaves our policy on eBay: look it up.
    const again = await listPolicies(token)
    for (const t of missing) created[t] ??= ours(t, again)
    if (missing.some((t) => !created[t])) throw failed.reason
  }

  // Reload so the new policies show up in the dropdowns, already selected.
  return loadPolicies(token, {
    ...loaded,
    fulfillmentPolicyId: loaded.fulfillmentPolicyId ?? created.fulfillment,
    paymentPolicyId: loaded.paymentPolicyId ?? created.payment,
    returnPolicyId: loaded.returnPolicyId ?? created.return,
  })
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
