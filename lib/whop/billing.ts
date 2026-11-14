// The Cross-Lister's Whop billing, managed inside FlipLedger: the cancel flow shows what the seller
// would lose, offers a pause or the yearly plan, and only then cancels (at the end of the period).
import "server-only"
import { whopConfig } from "./config"

const API = "https://api.whop.com/api/v1"

export type Membership = {
  id: string
  status: string
  cancel_at_period_end: boolean
  renewal_period_end: string | null
  plan: { id: string } | null
  product: { id: string } | null
  /** Set while payment collection is paused. */
  paused_at?: string | null
  pause_resumes_at?: string | null
}

export type BillingPlan = { kind: "monthly" | "yearly" | "other"; membership: Membership }

const LIVE = new Set(["active", "trialing", "past_due"])

/** The renewing membership the cancel flow acts on: prefer one that isn't already cancelling. Pure. */
export function pickRenewing(memberships: Membership[], annualPlanId: string): BillingPlan | null {
  const renewing = memberships.filter((m) => LIVE.has(m.status) || m.cancel_at_period_end)
  const sorted = [...renewing].sort((a, b) => Number(a.cancel_at_period_end) - Number(b.cancel_at_period_end))
  const m = sorted[0]
  if (!m) return null
  return { kind: m.plan?.id === annualPlanId ? "yearly" : m.plan ? "monthly" : "other", membership: m }
}

/**
 * After someone buys the yearly plan from the save offer, their monthly plan should stop renewing.
 * Returns the monthly memberships to cancel at period end. Pure.
 */
export function monthlyToRetire(memberships: Membership[], annualPlanId: string): Membership[] {
  const hasYearly = memberships.some((m) => m.plan?.id === annualPlanId && LIVE.has(m.status) && !m.cancel_at_period_end)
  if (!hasYearly) return []
  return memberships.filter((m) => m.plan?.id !== annualPlanId && LIVE.has(m.status) && !m.cancel_at_period_end)
}

async function whop<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { apiKey } = whopConfig()
  if (!apiKey) throw new Error("WHOP_API_KEY is not set")
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Whop ${init.method ?? "GET"} ${path} failed (${res.status}): ${text.slice(0, 300)}`)
  return (text ? JSON.parse(text) : {}) as T
}

/** The user's Cross-Lister memberships that still matter for billing. */
export async function crosslisterMemberships(whopUserId: string): Promise<Membership[]> {
  const { productIds } = whopConfig()
  const q = new URLSearchParams({ user_id: whopUserId, first: "50" })
  for (const p of productIds) q.append("product_ids", p)
  for (const s of ["active", "trialing", "past_due", "canceling", "paused"]) q.append("statuses", s)
  const res = await whop<{ data: Membership[] }>(`/memberships?${q}`)
  return res.data ?? []
}

/** Stop charging until `until`; the seller keeps access and billing resumes on its own. */
export function pauseMembership(id: string, until: Date) {
  return whop(`/memberships/${encodeURIComponent(id)}/pause`, { method: "POST", body: { until: until.toISOString() } })
}

export function resumeMembership(id: string) {
  return whop(`/memberships/${encodeURIComponent(id)}/resume`, { method: "POST", body: {} })
}

/** Cancel at the end of the paid period, so the seller keeps what they paid for. */
export function cancelMembership(id: string, reason: string) {
  return whop(`/memberships/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: { cancel_at_period_end: true, reason: reason.slice(0, 500) },
  })
}

/** Apply the save-offer promo code (WHOP_SAVE_PROMO_CODE) to the next renewals. */
export function applyPromo(id: string, code: string) {
  return whop(`/memberships/${encodeURIComponent(id)}/apply_promo_code`, { method: "POST", body: { promo_code: code } })
}

export type BillingState =
  | { linked: false }
  | {
      linked: true
      plan: "monthly" | "yearly" | "other" | null
      membershipId: string | null
      renewsAt: string | null
      canceling: boolean
      paused: boolean
      resumesAt: string | null
      error?: boolean
    }

/**
 * What the seller's Cross-Lister billing looks like right now. Also finishes a "switch to yearly":
 * once a yearly membership is live, any monthly one is set to cancel at the end of its period.
 */
export async function billingState(whopUserId: string | null): Promise<BillingState> {
  if (!whopUserId) return { linked: false }
  const { annualPlanId, apiKey } = whopConfig()
  const empty = { linked: true as const, plan: null, membershipId: null, renewsAt: null, canceling: false, paused: false, resumesAt: null }
  if (!apiKey) return empty
  try {
    const all = await crosslisterMemberships(whopUserId)
    if (annualPlanId) {
      for (const m of monthlyToRetire(all, annualPlanId)) {
        await cancelMembership(m.id, "FlipLedger: switched to the yearly plan")
        m.cancel_at_period_end = true
      }
    }
    const pick = pickRenewing(all, annualPlanId)
    if (!pick) return empty
    const m = pick.membership
    return {
      linked: true,
      plan: pick.kind,
      membershipId: m.id,
      renewsAt: m.renewal_period_end,
      canceling: m.cancel_at_period_end,
      paused: Boolean(m.paused_at) || m.status === "paused",
      resumesAt: m.pause_resumes_at ?? null,
    }
  } catch (e) {
    console.error("[whop billing] read failed", e)
    return { ...empty, error: true }
  }
}
