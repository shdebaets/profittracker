import { Check, Share2 } from "lucide-react"
import Link from "next/link"
import { PageTitle } from "@/components/app-header"
import { formatDate } from "@/lib/dates"
import { createAdminClient } from "@/lib/supabase/admin"
import { canCrosslist, requireUser } from "@/lib/supabase/server"
import { billingState } from "@/lib/whop/billing"
import { MANAGE_BILLING_URL, whopConfig } from "@/lib/whop/config"
import { RecheckButton } from "./recheck-button"
import { ResumeButton } from "./resume-button"

const PERKS = [
  "List on eBay straight from FlipLedger",
  "Auto-fill Facebook Marketplace, Poshmark and Mercari with the Chrome extension",
  "Sales sync and delist everywhere when something sells",
  "Import your existing Poshmark and Mercari listings",
]

const PLAN_LABEL = { monthly: "Monthly plan", yearly: "Yearly plan", other: "Cross-Lister plan" } as const

const WHOP_ERRORS: Record<string, string> = {
  whop: "Connecting your Whop account didn't work. Try again.",
  "whop-email": "Verify your email on Whop first, then try again.",
  "whop-linked": "This FlipLedger account is already linked to a different Whop account.",
}

export default async function CrosslisterPage({ searchParams }: PageProps<"/crosslister">) {
  const [{ userId }, unlocked, { whop_error }] = await Promise.all([requireUser(), canCrosslist(), searchParams])
  const whopError = typeof whop_error === "string" ? (WHOP_ERRORS[whop_error] ?? WHOP_ERRORS.whop) : null
  const { checkoutUrl, annualUrl, clientId } = whopConfig()
  // whop_links is service-role only; scoped to this user.
  const { data: link } = await createAdminClient()
    .from("whop_links")
    .select("whop_user_id")
    .eq("user_id", userId)
    .maybeSingle<{ whop_user_id: string }>()
  const billing = await billingState(link?.whop_user_id ?? null)

  return (
    <>
      <PageTitle title="Cross-Lister" subtitle="List once, sell everywhere" />
      {whopError && (
        <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {whopError}
        </p>
      )}
      <div className="flex flex-col gap-4 rounded-3xl border bg-card p-5">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-soft">
          <Share2 className="size-5 text-brand" />
        </span>
        <ul className="flex flex-col gap-2 text-sm">
          {PERKS.map((p) => (
            <li key={p} className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-profit" />
              {p}
            </li>
          ))}
        </ul>

        {unlocked ? (
          <>
            <p className="rounded-2xl bg-profit-soft px-4 py-3 text-sm">You have the Cross-Lister. Open any item and tap Cross-list.</p>
            <Link href="/settings" className="flex h-12 items-center justify-center rounded-2xl border font-semibold">
              Connect marketplaces
            </Link>
          </>
        ) : (
          <>
            {checkoutUrl ? (
              <div className="grid gap-2">
                <a href={checkoutUrl} className="flex h-12 items-center justify-center rounded-2xl bg-brand font-bold text-ink">
                  Get the Cross-Lister · $30/month
                </a>
                {annualUrl && (
                  <a href={annualUrl} className="flex h-12 items-center justify-center rounded-2xl border font-semibold">
                    Or $300/year (2 months free)
                  </a>
                )}
              </div>
            ) : (
              <p className="text-center text-sm text-muted-foreground">The Cross-Lister opens soon.</p>
            )}
            {!billing.linked && clientId ? (
              <a href="/auth/whop/start" className="flex h-12 items-center justify-center rounded-2xl border font-semibold">
                Already bought it? Connect your Whop account
              </a>
            ) : (
              <RecheckButton />
            )}
          </>
        )}
      </div>

      {billing.linked && billing.plan && (
        <div className="flex flex-col gap-3 rounded-3xl border bg-card p-5 text-sm">
          <p className="font-semibold">Your plan</p>
          <p className="text-muted-foreground">
            {PLAN_LABEL[billing.plan]}
            {billing.paused
              ? ` · paused${billing.resumesAt ? ` until ${formatDate(billing.resumesAt)}` : ""}`
              : billing.canceling
                ? ` · ends ${billing.renewsAt ? formatDate(billing.renewsAt) : "at the end of this period"}`
                : billing.renewsAt
                  ? ` · renews ${formatDate(billing.renewsAt)}`
                  : ""}
          </p>
          {billing.paused ? (
            <ResumeButton />
          ) : (
            !billing.canceling && (
              <Link href="/crosslister/cancel" className="flex h-11 items-center justify-center rounded-2xl border font-semibold">
                Pause or cancel
              </Link>
            )
          )}
          {billing.canceling && (
            <p className="text-xs text-muted-foreground">
              Changed your mind? Buy again any time from this page. Your listings and history stay in FlipLedger.
            </p>
          )}
        </div>
      )}
      {billing.linked && billing.error && (
        <p className="text-center text-sm text-muted-foreground">Couldn&apos;t load your plan from Whop right now. Try again in a minute.</p>
      )}

      <a href={MANAGE_BILLING_URL} target="_blank" rel="noreferrer" className="text-center text-sm text-muted-foreground underline">
        Payment method and receipts on Whop
      </a>
    </>
  )
}
