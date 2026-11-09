import { Logo } from "@/components/logo"
import { LoginForm } from "./login-form"

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6 py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo size={64} />
        <h1 className="text-3xl font-bold tracking-tight">
          Flip<span className="text-brand">Ledger</span>
        </h1>
        <p className="text-muted-foreground">Know exactly what every flip made you.</p>
      </div>
      {error === "browser" && (
        <p className="rounded-xl bg-muted px-4 py-3 text-sm">
          Your email is confirmed, but the link opened in a different browser than the one you signed up in.
          Sign in below.
        </p>
      )}
      {error === "link" && (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          That link has expired or was already used. Sign in below, or request a new link.
        </p>
      )}
      <LoginForm />
    </main>
  )
}
