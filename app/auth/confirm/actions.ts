"use server"

import { redirect } from "next/navigation"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { reportError } from "@/lib/errors"

const schema = z.object({
  token_hash: z.string().min(1),
  type: z.enum(["signup", "invite", "magiclink", "recovery", "email_change", "email"]),
})

// Runs only when the person taps the button, so mail scanners and link
// previews that open the URL can't use up the one-time token first.
export async function confirmEmail(formData: FormData) {
  const parsed = schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) redirect("/login?error=link")

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp(parsed.data)
  if (error) {
    // Already used, but this browser is signed in (e.g. tapped twice).
    const { data } = await supabase.auth.getUser()
    if (!data.user) {
      reportError(error, "auth confirm")
      redirect("/login?error=link")
    }
  }
  redirect("/")
}
