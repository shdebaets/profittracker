"use server"

import { z } from "zod"
import { AiError } from "@/lib/ai/listing"
import { guessPackage as guess, SHIPPING_KIND, type PackageGuess } from "@/lib/ai/package-guess"
import { AI_DAILY_LIMIT, FAIR_USE_MESSAGE } from "@/lib/ai/usage"
import { reportError, UserError } from "@/lib/errors"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMember } from "@/lib/supabase/server"
import { fail } from "./result"

export type PackageGuessResult = { ok: true; guess: PackageGuess } | { ok: false; error: string }

/** AI guess of a product's packed weight and box. Saves nothing; the seller can change both. */
export async function guessPackage(title: string): Promise<PackageGuessResult> {
  try {
    const t = z.string().trim().min(2, "Type what you're shipping first").max(200).parse(title)
    const { userId } = await requireMember()
    // ai_usage is service-role only, scoped to this user. Its own fair-use cap, apart from AI listings.
    const admin = createAdminClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const { count, error } = await admin
      .from("ai_usage")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", SHIPPING_KIND)
      .gte("created_at", since)
    if (error) throw error
    if ((count ?? 0) >= AI_DAILY_LIMIT) throw new UserError(FAIR_USE_MESSAGE)
    const { guess: g, usage } = await guess(t)
    await admin.from("ai_usage").insert({ user_id: userId, kind: SHIPPING_KIND, input_tokens: usage.input, output_tokens: usage.output })
    return { ok: true, guess: g }
  } catch (e) {
    if (e instanceof AiError) {
      reportError(e, "ai package guess")
      return { ok: false, error: "Couldn't guess the size right now. Enter the weight and box yourself." }
    }
    return fail(e) as { ok: false; error: string }
  }
}
