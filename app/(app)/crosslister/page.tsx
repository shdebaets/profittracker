import { Check, Share2 } from "lucide-react"
import Link from "next/link"
import { PageTitle } from "@/components/app-header"
import { canCrosslist, requireUser } from "@/lib/supabase/server"
import { MANAGE_BILLING_URL, whopConfig } from "@/lib/whop/config"
import { RecheckButton } from "./recheck-button"

const PERKS = [
  "List on eBay straight from FlipLedger",
  "Auto-fill Facebook Marketplace, Poshmark and Mercari with the Chrome extension",
  "Sales sync and delist everywhere when something sells",
  "Import your existing Poshmark and Mercari listings",
]

export default async function CrosslisterPage() {
  const [, unlocked] = await Promise.all([requireUser(), canCrosslist()])
  const { checkoutUrl } = whopConfig()

  return (
    <>
      <PageTitle title="Cross-Lister" subtitle="List once, sell everywhere" />
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
              <a
                href={checkoutUrl}
                className="flex h-12 items-center justify-center rounded-2xl bg-primary font-semibold text-primary-foreground"
              >
                Get the Cross-Lister
              </a>
            ) : (
              <p className="text-center text-sm text-muted-foreground">The Cross-Lister opens soon.</p>
            )}
            <RecheckButton />
          </>
        )}
        <a href={MANAGE_BILLING_URL} target="_blank" rel="noreferrer" className="text-center text-sm text-muted-foreground underline">
          Manage billing on Whop
        </a>
      </div>
    </>
  )
}
