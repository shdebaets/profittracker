import { Logo } from "@/components/logo"
import { LoginForm } from "./login-form"

// Sign-in uses the design's dark landing look; the app itself stays light.
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams
  return (
    <div className="dark relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-64 left-1/2 h-[42rem] w-[68rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(245_152_42/0.24),transparent)]"
      />
      <main className="relative mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6 py-12">
        <div className="flex flex-col items-center gap-4 text-center">
          <Logo size={64} />
          <p className="font-heading text-2xl font-bold tracking-tight">
            Flip<span className="text-brand">Ledger</span>
          </p>
          <h1 className="text-[2.6rem] leading-[0.95] font-bold tracking-[-0.045em] text-white">
            Know every
            <br />
            <span className="bg-gradient-to-r from-[#f5982a] via-[#ffd08a] to-[#2bd67b] bg-clip-text text-transparent">
              dollar you flip.
            </span>
          </h1>
          <p className="text-muted-foreground">Profit, inventory, sales and write-offs in one app.</p>
        </div>
        {error === "browser" && (
          <p className="rounded-2xl border bg-card px-4 py-3 text-sm">
            Your email is confirmed, but the link opened in a different browser than the one you signed up in.
            Sign in below.
          </p>
        )}
        {error === "link" && (
          <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            That link has expired or was already used. Sign in below, or request a new link.
          </p>
        )}
        <LoginForm />
      </main>
    </div>
  )
}
