import { redirect } from "next/navigation"
import { Logo } from "@/components/logo"
import { confirmEmail } from "./actions"
import { ConfirmButton } from "./confirm-button"

export default async function ConfirmPage({ searchParams }: PageProps<"/auth/confirm">) {
  const { token_hash, type } = await searchParams
  if (typeof token_hash !== "string" || typeof type !== "string") redirect("/login?error=link")

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6 py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo size={64} />
        <h1 className="text-3xl font-bold tracking-tight">
          Flip<span className="text-brand">Ledger</span>
        </h1>
        <p className="text-muted-foreground">Tap Continue to finish signing in.</p>
      </div>
      <form action={confirmEmail} className="rounded-2xl border bg-card p-6">
        <input type="hidden" name="token_hash" value={token_hash} />
        <input type="hidden" name="type" value={type} />
        <ConfirmButton />
      </form>
    </main>
  )
}
