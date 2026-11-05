import { redirect } from "next/navigation"
import { Logo } from "@/components/logo"
import { getSessionUser } from "@/lib/supabase/server"
import { hasPaidAccess } from "@/lib/whop/access"
import { MANAGE_BILLING_URL, whopConfig } from "@/lib/whop/config"
import { RecheckButton } from "./recheck-button"

export default async function SubscribePage() {
  const { userId, email } = await getSessionUser()
  if (await hasPaidAccess(userId, email)) redirect("/")
  const { checkoutUrl } = whopConfig()

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6 py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo size={64} />
        <h1 className="text-3xl font-bold tracking-tight">
          Flip<span className="text-brand">Ledger</span>
        </h1>
        <p className="text-muted-foreground">FlipLedger needs a membership. Get one on Whop to start tracking your flips.</p>
      </div>
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-6 shadow-sm">
        {checkoutUrl ? (
          <a
            href={checkoutUrl}
            className="flex h-12 items-center justify-center rounded-2xl bg-primary font-semibold text-primary-foreground"
          >
            Get access
          </a>
        ) : (
          <p className="text-center text-sm text-muted-foreground">Memberships open soon.</p>
        )}
        <RecheckButton />
        <p className="text-center text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{email}</span>.{" "}
          <a href={MANAGE_BILLING_URL} className="underline" target="_blank" rel="noreferrer">
            Manage billing
          </a>
        </p>
      </div>
      <form action="/auth/signout" method="post">
        <button className="h-12 w-full rounded-2xl border bg-card font-semibold text-destructive">Sign out</button>
      </form>
    </main>
  )
}
