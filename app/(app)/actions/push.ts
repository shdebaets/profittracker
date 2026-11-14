"use server"

import { z } from "zod"
import { UserError } from "@/lib/errors"
import { vapidKeys } from "@/lib/push/keys"
import { pushToUser } from "@/lib/push/send"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireUser } from "@/lib/supabase/server"
import { fail, type ActionResult } from "./result"

/** The VAPID public key the browser subscribes with, or null when push isn't set up on the server. */
export async function pushPublicKey(): Promise<string | null> {
  await requireUser()
  return vapidKeys()?.publicKey ?? null
}

const subSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
})

export async function savePushSubscription(input: unknown): Promise<ActionResult> {
  try {
    const sub = subSchema.parse(input)
    const { userId } = await requireUser()
    // Endpoints are unique per device; if another account used this browser before, it moves here.
    const admin = createAdminClient()
    const { error } = await admin
      .from("push_subscriptions")
      .upsert({ user_id: userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth }, { onConflict: "endpoint" })
    if (error) throw error
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function removePushSubscription(endpoint: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser()
    const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", z.string().max(1000).parse(endpoint))
    if (error) throw error
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function sendTestPush(): Promise<ActionResult> {
  try {
    const { userId } = await requireUser()
    const sent = await pushToUser(createAdminClient(), userId, {
      title: "FlipLedger notifications are on",
      body: "You'll get your Sunday recap and a note after every sourcing trip.",
      url: "/recap",
      tag: "test",
    })
    if (!sent) throw new UserError("No device got it. Turn notifications off and on again, then retry.")
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
