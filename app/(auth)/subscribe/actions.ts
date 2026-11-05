"use server"

import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/supabase/server"
import { hasPaidAccess } from "@/lib/whop/access"

export type RecheckState = { checked?: boolean }

/** "I already bought it": ask Whop again now instead of waiting for the cache to expire. */
export async function recheckAccess(): Promise<RecheckState> {
  const { userId, email } = await getSessionUser()
  if (await hasPaidAccess(userId, email, true)) redirect("/")
  return { checked: true }
}
