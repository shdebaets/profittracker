"use client"

import { useActionState, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { authenticate, type LoginState } from "./actions"

type Mode = "signin" | "signup" | "magic"

export function LoginForm() {
  const [mode, setMode] = useState<Mode>("signin")
  const [state, formAction, pending] = useActionState<LoginState, FormData>(authenticate, {})
  const [dismissedSent, setDismissedSent] = useState<string | null>(null)

  if (state.sentTo && dismissedSent !== state.sentTo) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-center">
        <p className="font-semibold">Check your email</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a link to <span className="font-medium text-foreground">{state.sentTo}</span>.
        </p>
        <Button variant="ghost" className="mt-4" onClick={() => setDismissedSent(state.sentTo!)}>
          Use a different email
        </Button>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-sm">
      <input type="hidden" name="mode" value={mode} />
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1 text-sm font-medium">
        {(["signin", "signup", "magic"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn("rounded-lg py-2 transition", mode === m ? "bg-card shadow-sm" : "text-muted-foreground")}
          >
            {m === "signin" ? "Sign in" : m === "signup" ? "Sign up" : "Email link"}
          </button>
        ))}
      </div>
      {state.error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email" name="email" type="email" autoComplete="email" required className="h-12 rounded-xl"
          defaultValue={state.email}
        />
      </div>
      {mode !== "magic" && (
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password" name="password" type="password" required minLength={6} className="h-12 rounded-xl"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
        </div>
      )}
      <Button type="submit" disabled={pending} className="h-12 rounded-xl text-base font-semibold">
        {pending ? "Working…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send sign-in link"}
      </Button>
    </form>
  )
}
