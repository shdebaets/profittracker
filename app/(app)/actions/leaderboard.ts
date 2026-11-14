"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { UserError } from "@/lib/errors"
import { monthLabel, monthOf, prevMonth } from "@/lib/leaderboard"
import { sellerMonth } from "@/lib/leaderboard-data"
import { formatCents } from "@/lib/money"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireUser } from "@/lib/supabase/server"
import { winCard } from "@/lib/win-card"
import { fail, type ActionResult } from "./result"

const profileSchema = z.object({
  name: z.string().trim().min(1, "Pick a name").max(24).regex(/^[\p{L}\p{N} ._'-]+$/u, "Letters, numbers and spaces only"),
  optedIn: z.boolean(),
})

export async function saveLeaderboardProfile(input: z.input<typeof profileSchema>): Promise<ActionResult> {
  try {
    const p = profileSchema.parse(input)
    const { supabase, userId } = await requireUser()
    const { error } = await supabase
      .from("leaderboard_profiles")
      .upsert({ user_id: userId, display_name: p.name, opted_in: p.optedIn, updated_at: new Date().toISOString() })
    if (error) throw error
    revalidatePath("/leaderboard")
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/** Post the seller's win card to the eMoney Discord wins channel (DISCORD_WINS_WEBHOOK_URL). Once a month. */
export async function postWinToDiscord(which: "this" | "last"): Promise<ActionResult> {
  try {
    const hook = process.env.DISCORD_WINS_WEBHOOK_URL?.trim()
    if (!hook) throw new UserError("Posting to Discord isn't set up yet.")
    const { supabase, userId } = await requireUser()
    const now = monthOf(new Date())
    const m = which === "last" ? prevMonth(now) : now
    const key = `${m.year}-${m.month + 1}`
    // email_log doubles as a once-per-month guard; service role only.
    const admin = createAdminClient()
    const { data: sent } = await admin.from("email_log").select("user_id").eq("user_id", userId).eq("kind", "win-post").eq("period_key", key).maybeSingle()
    if (sent) throw new UserError(`You already posted your ${monthLabel(m)} win.`)
    const totals = await sellerMonth(supabase, userId, m)
    if (totals.profit <= 0) throw new UserError("Post a win once you've got profit this month.")
    const { data: profile } = await supabase.from("leaderboard_profiles").select("display_name").maybeSingle()
    const name = profile?.display_name ?? "A FlipLedger seller"
    const png = await winCard({ name, month: monthLabel(m), ...totals }).arrayBuffer()

    const form = new FormData()
    form.append(
      "payload_json",
      JSON.stringify({ content: `${name} made ${formatCents(totals.profit)} profit in ${monthLabel(m)} 🚀 (${totals.itemsSold} sold, tracked in FlipLedger)`, allowed_mentions: { parse: [] } }),
    )
    form.append("files[0]", new Blob([png], { type: "image/png" }), "win.png")
    const res = await fetch(hook, { method: "POST", body: form })
    if (!res.ok) throw new Error(`Discord webhook ${res.status}`)
    await admin.from("email_log").insert({ user_id: userId, kind: "win-post", period_key: key })
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
