import { Lock } from "lucide-react"
import Link from "next/link"

/** Shown in place of cross-listing tools for people without the Cross-Lister. */
export function CrosslistUpsell({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-3xl border bg-card p-5 text-sm">
      <p className="flex items-center gap-2 font-semibold">
        <Lock className="size-4 text-brand" /> Cross-listing is part of the Cross-Lister
      </p>
      {!compact && (
        <p className="text-muted-foreground">
          List on eBay, Facebook, Poshmark and Mercari from FlipLedger, and delist everywhere when something sells.
        </p>
      )}
      <Link
        href="/crosslister"
        className="flex h-11 items-center justify-center rounded-2xl bg-primary font-semibold text-primary-foreground"
      >
        See the Cross-Lister
      </Link>
    </div>
  )
}
