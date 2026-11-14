"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { fail, type ActionResult } from "@/app/(app)/actions/result"
import { UserError } from "@/lib/errors"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireUser } from "@/lib/supabase/server"
import { hasCrosslistAccess } from "@/lib/whop/access"
import { applyPromo, cancelMembership, crosslisterMemberships, pauseMembership, pickRenewing, resumeMembership } from "@/lib/whop/billing"
import { whopConfig } from "@/lib/whop/config"

export type RecheckState = { checked?: boolean; unlocked?: boolean }

/** "I already bought it": ask Whop again now instead of waiting for the 10-minute cache. */
export async function recheckAccess(): Promise<RecheckState> {
  const { userId, email } = await requireUser()
  const unlocked = await hasCrosslistAccess(userId, email, true)
  if (unlocked) revalidatePath("/", "layout")
  return { checked: true, unlocked }
}

/** The signed-in user's renewing Cross-Lister membership. Never trusts an id from the browser. */
async function myMembership() {
  const { userId } = await requireUser()
  const { data } = await createAdminClient()
    .from("whop_links")
    .select("whop_user_id")
    .eq("user_id", userId)
    .maybeSingle<{ whop_user_id: string }>()
  if (!data) throw new UserError("Connect your Whop account first.")
  const plan = pickRenewing(await crosslisterMemberships(data.whop_user_id), whopConfig().annualPlanId)
  if (!plan) throw new UserError("We couldn't find a Cross-Lister subscription that renews on this account.")
  return plan.membership
}

function done(): ActionResult {
  revalidatePath("/crosslister")
  return { ok: true }
}

export async function pauseCrosslister(months: number): Promise<ActionResult> {
  try {
    const n = z.number().int().min(1).max(3).parse(months)
    const m = await myMembership()
    const until = new Date()
    until.setMonth(until.getMonth() + n)
    await pauseMembership(m.id, until)
    return done()
  } catch (e) {
    return fail(e)
  }
}

export async function resumeCrosslister(): Promise<ActionResult> {
  try {
    await resumeMembership((await myMembership()).id)
    return done()
  } catch (e) {
    return fail(e)
  }
}

export async function acceptSaveOffer(): Promise<ActionResult> {
  try {
    const { savePromoCode } = whopConfig()
    if (!savePromoCode) throw new UserError("That offer isn't available right now.")
    await applyPromo((await myMembership()).id, savePromoCode)
    return done()
  } catch (e) {
    return fail(e)
  }
}

const cancelSchema = z.object({
  reason: z.string().trim().min(1, "Pick a reason").max(100),
  note: z.string().trim().max(400).optional(),
})

/** Cancels at the end of the paid period. */
export async function cancelCrosslister(input: z.input<typeof cancelSchema>): Promise<ActionResult> {
  try {
    const c = cancelSchema.parse(input)
    const m = await myMembership()
    await cancelMembership(m.id, `FlipLedger cancel flow: ${c.reason}${c.note ? ` (${c.note})` : ""}`)
    return done()
  } catch (e) {
    return fail(e)
  }
}
