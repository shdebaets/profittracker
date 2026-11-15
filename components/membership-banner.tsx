import { Lock } from "lucide-react"
import Link from "next/link"

/** Shown on every page to people without an active membership: they can view and export, not change. */
export function MembershipBanner() {
  return (
    <Link
      href="/crosslister"
      className="flex items-start gap-3 rounded-2xl border border-brand/40 bg-brand-soft px-4 py-3 text-sm"
    >
      <Lock className="mt-0.5 size-4 shrink-0 text-brand" />
      <span className="min-w-0">
        <b>View-only.</b> You can see and export your history. Get a FlipLedger membership to add items, log sales and
        cross-list. <span className="font-semibold underline">See plans</span>
      </span>
    </Link>
  )
}
