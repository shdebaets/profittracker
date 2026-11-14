"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireCrosslister } from "@/lib/supabase/server"
import { fail, type ActionResult } from "./result"

const ruleSchema = z
  .object({
    enabled: z.boolean(),
    discountPct: z.number().int().min(5).max(50),
    maxDiscountPct: z.number().int().min(5).max(60),
    floorMarginPct: z.number().int().min(0).max(300),
    minAgeDays: z.number().int().min(0).max(365),
    everyDays: z.number().int().min(1).max(14),
  })
  .refine((r) => r.maxDiscountPct >= r.discountPct, { message: "The max discount has to be at least the starting discount" })

export async function saveOfferRules(input: z.input<typeof ruleSchema>): Promise<ActionResult> {
  try {
    const r = ruleSchema.parse(input)
    const { supabase, userId } = await requireCrosslister()
    const { error } = await supabase.from("smart_offer_rules").upsert({
      user_id: userId,
      enabled: r.enabled,
      discount_pct: r.discountPct,
      max_discount_pct: r.maxDiscountPct,
      floor_margin_pct: r.floorMarginPct,
      min_age_days: r.minAgeDays,
      every_days: r.everyDays,
      updated_at: new Date().toISOString(),
    })
    if (error) throw error
    revalidatePath("/settings")
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
