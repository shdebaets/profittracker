import { Logo } from "@/components/logo"
import { whopConfig } from "@/lib/whop/config"
import { LoginForm } from "./login-form"

const ERRORS: Record<string, string> = {
  link: "That sign-in link is invalid or expired. Try again.",
  whop: "Signing in with Whop didn't work. Try again.",
  "whop-email": "Verify your email on Whop first, then sign in again.",
  "whop-linked": "This email's FlipLedger account is already linked to a different Whop account. Sign in with that Whop account.",
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams
  const { clientId, emailLogin } = whopConfig()
  const message = typeof error === "string" ? ERRORS[error] : undefined
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6 py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo size={64} />
        <h1 className="text-3xl font-bold tracking-tight">
          Flip<span className="text-brand">Ledger</span>
        </h1>
        <p className="text-muted-foreground">Know exactly what every flip made you.</p>
      </div>
      {message && <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{message}</p>}
      {clientId && (
        // A plain link, not next/link: the route redirects off-site to Whop.
        <a
          href="/auth/whop/start"
          className="flex h-12 items-center justify-center rounded-2xl bg-primary font-semibold text-primary-foreground shadow-sm"
        >
          Sign in with Whop
        </a>
      )}
      {emailLogin && <LoginForm />}
    </main>
  )
}
