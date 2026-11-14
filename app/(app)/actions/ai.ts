"use server"

import { z } from "zod"
import { AiError, draftListingFromPhotos, type ListingDraft } from "@/lib/ai/listing"
import { aiHintsFrom } from "@/lib/ai/hints"
import { AI_DAILY_LIMIT, FAIR_USE_MESSAGE, LISTING_KIND, listingCallsToday } from "@/lib/ai/usage"
import { reportError, UserError } from "@/lib/errors"
import { signPaths } from "@/lib/photos"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireUser } from "@/lib/supabase/server"
import { fail } from "./result"

export type AiDraftResult = { ok: true; draft: ListingDraft } | { ok: false; error: string }

/** Draft a listing from the item's photos. Saves nothing; the seller reviews it in the form. */
export async function aiDraftListing(itemId: string): Promise<AiDraftResult> {
  try {
    const id = z.uuid().parse(itemId)
    const { supabase, userId } = await requireUser()
    const { data: item, error } = await supabase.from("items").select("title, photo_paths").eq("id", id).single()
    if (error) throw error
    const paths = (item.photo_paths as string[] | null) ?? []
    if (!paths.length) throw new UserError("Add at least one photo first. The AI writes the listing from your photos.")

    // ai_usage is service-role only, scoped to this user. Silent abuse cap: no count shown until it's hit.
    const admin = createAdminClient()
    if ((await listingCallsToday(admin, userId)) >= AI_DAILY_LIMIT) throw new UserError(FAIR_USE_MESSAGE)

    const urls = await signPaths(supabase, paths.slice(0, 4), 600)
    const { draft, usage } = await draftListingFromPhotos(paths.slice(0, 4).map((p) => urls.get(p)!).filter(Boolean), item.title)
    await admin.from("ai_usage").insert({ user_id: userId, kind: LISTING_KIND, input_tokens: usage.input, output_tokens: usage.output })
    // Category and platform suggestions stay on the item for the eBay form and the extension.
    // Only suggestions, never the listing itself (the seller saves that from the form).
    await supabase.from("items").update({ ai_hints: aiHintsFrom(draft) }).eq("id", id)
    return { ok: true, draft }
  } catch (e) {
    if (e instanceof AiError) {
      reportError(e, "ai listing")
      return { ok: false, error: "The AI couldn't write this one right now. Try again in a minute." }
    }
    return fail(e) as { ok: false; error: string }
  }
}
