"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { friendlyError } from "@/lib/errors"

export type LoginState = { error?: string; sentTo?: string; email?: string }

const schema = z.object({
  mode: z.enum(["signin", "signup", "magic"]),
  email: z.email("Enter a valid email"),
  password: z.string().optional(),
})

async function callbackUrl() {
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host")
  // Vercel always sets x-forwarded-proto; local dev (localhost or LAN IP) is plain http.
  const proto = h.get("x-forwarded-proto") ?? "http"
  return `${proto}://${host}/auth/callback`
}

// Auth runs on the server so the browser only ever talks to this app, never to Supabase directly.
export async function authenticate(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const { mode, email, password = "" } = parsed.data
  if (mode !== "magic" && password.length < 6) return { error: "Password must be at least 6 characters", email }

  const supabase = await createClient()
  const emailRedirectTo = await callbackUrl()

  if (mode === "magic") {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } })
    return error ? { error: friendlyError(error), email } : { sentTo: email }
  }
  if (mode === "signup") {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo } })
    if (error) return { error: friendlyError(error), email }
    if (!data.session) return { sentTo: email }
  } else {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: friendlyError(error), email }
  }
  redirect("/")
}
