"use server"

import { revalidatePath } from "next/cache"
import { requireUser } from "@/lib/supabase/server"
import { hasCrosslistAccess } from "@/lib/whop/access"

export type RecheckState = { checked?: boolean; unlocked?: boolean }

/** "I already bought it": ask Whop again now instead of waiting for the 10-minute cache. */
export async function recheckAccess(): Promise<RecheckState> {
  const { userId, email } = await requireUser()
  const unlocked = await hasCrosslistAccess(userId, email, true)
  if (unlocked) revalidatePath("/", "layout")
  return { checked: true, unlocked }
}
