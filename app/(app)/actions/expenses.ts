"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { loadUserData, sendRecap } from "@/lib/email/jobs"
import { EmailError } from "@/lib/email/send"
import { reportError, UserError } from "@/lib/errors"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireUser } from "@/lib/supabase/server"
import { mileageDeduction } from "@/lib/profit"
import { tripPush } from "@/lib/push/messages"
import { pushToUser } from "@/lib/push/send"
import { fail, type ActionResult } from "./result"

const cents = z.number().int().min(0).max(100_000_000)

function done(): ActionResult {
  revalidatePath("/", "layout")
  return { ok: true }
}

const expenseSchema = z.object({
  title: z.string().trim().min(1, "Add a description").max(200),
  category: z.string().trim().min(1).max(60),
  amountCents: cents,
  spentAt: z.string().min(1),
})
export type ExpenseInput = z.input<typeof expenseSchema>

export async function saveExpense(id: string | null, input: ExpenseInput): Promise<ActionResult> {
  try {
    const e = expenseSchema.parse(input)
    const { supabase } = await requireUser()
    const row = {
      kind: "expense" as const,
      title: e.title,
      category: e.category,
      amount_cents: e.amountCents,
      spent_at: new Date(e.spentAt).toISOString(),
    }
    const { error } = id
      ? await supabase.from("expenses").update(row).eq("id", id)
      : await supabase.from("expenses").insert(row)
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

const mileageSchema = z.object({
  purpose: z.string().trim().min(1).max(200),
  miles: z.number().positive("Enter miles driven").max(10_000),
  rateCents: z.number().int().min(0).max(1000),
  spentAt: z.string().min(1),
  startLocation: z.string().trim().max(200).optional(),
  endLocation: z.string().trim().max(200).optional(),
})
export type MileageInput = z.input<typeof mileageSchema>

export async function logMileage(input: MileageInput): Promise<ActionResult> {
  try {
    const m = mileageSchema.parse(input)
    const { supabase, userId } = await requireUser()
    const deduction = mileageDeduction(m.miles, m.rateCents)
    const { error } = await supabase.from("expenses").insert({
      kind: "mileage",
      title: `Mileage: ${m.purpose}`,
      category: "Travel",
      miles: m.miles,
      rate_cents: m.rateCents,
      amount_cents: deduction,
      spent_at: new Date(m.spentAt).toISOString(),
      start_location: m.startLocation || null,
      end_location: m.endLocation || null,
    })
    if (error) throw error
    // "12.4 mi logged, $8.68 write-off" on their devices. Never fails the save.
    await pushToUser(createAdminClient(), userId, tripPush(m.miles, deduction)).catch((e) => reportError(e, "trip push"))
    return done()
  } catch (e) {
    return fail(e)
  }
}

export async function deleteExpense(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser()
    const { error } = await supabase.from("expenses").delete().eq("id", id)
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

const subSchema = z.object({
  name: z.string().trim().min(1, "Name the subscription").max(100),
  amountCents: cents,
})

export async function createSubscription(input: z.input<typeof subSchema>): Promise<ActionResult> {
  try {
    const s = subSchema.parse(input)
    const { supabase } = await requireUser()
    const { error } = await supabase.from("subscriptions").insert({ name: s.name, amount_cents: s.amountCents })
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

export async function setSubscriptionActive(id: string, active: boolean): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser()
    const { error } = await supabase.from("subscriptions").update({ active }).eq("id", id)
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

export async function deleteSubscription(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser()
    const { error } = await supabase.from("subscriptions").delete().eq("id", id)
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

const bracket = z.number().min(0).max(0.5)

const settingsSchema = z.object({
  mileageRateCents: z.number().int().min(0).max(1000),
  defaultReturnDays: z.number().int().min(0).max(365),
  taxBracket: bracket,
  staleDays: z.union([z.literal(30), z.literal(45), z.literal(60), z.literal(90), z.literal(120)]),
  emailRecap: z.boolean(),
  emailTaxReminders: z.boolean(),
})

export async function saveSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  try {
    const s = settingsSchema.parse(input)
    const { supabase, userId } = await requireUser()
    const { error } = await supabase.from("settings").upsert({
      user_id: userId,
      mileage_rate_cents: s.mileageRateCents,
      default_return_days: s.defaultReturnDays,
      tax_bracket: s.taxBracket,
      tax_bracket_set: true,
      stale_days: s.staleDays,
      email_recap: s.emailRecap,
      email_tax_reminders: s.emailTaxReminders,
    })
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

/** Set just the tax bracket (the dashboard's quick picker). */
export async function saveTaxBracket(value: number): Promise<ActionResult> {
  try {
    const b = bracket.parse(value)
    const { supabase, userId } = await requireUser()
    const { data: existing } = await supabase.from("settings").select("user_id").maybeSingle()
    const { error } = existing
      ? await supabase.from("settings").update({ tax_bracket: b, tax_bracket_set: true }).eq("user_id", userId)
      : await supabase.from("settings").insert({ user_id: userId, tax_bracket: b, tax_bracket_set: true })
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

const taxFormSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  platform: z.enum(["ebay", "mercari", "poshmark", "facebook", "depop", "local", "other"]),
  /** null clears it. */
  grossCents: z.number().int().min(0).max(10_000_000_000).nullable(),
})

/** Save (or clear) the gross a marketplace's 1099-K reported. */
export async function saveTaxForm(input: z.input<typeof taxFormSchema>): Promise<ActionResult> {
  try {
    const f = taxFormSchema.parse(input)
    const { supabase, userId } = await requireUser()
    const { error } =
      f.grossCents === null
        ? await supabase.from("tax_forms").delete().eq("tax_year", f.year).eq("platform", f.platform)
        : await supabase.from("tax_forms").upsert({
            user_id: userId,
            tax_year: f.year,
            platform: f.platform,
            gross_cents: f.grossCents,
            updated_at: new Date().toISOString(),
          })
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}

/** Settings → "Email me this week's recap now": sends it right away, even for a quiet week. */
export async function sendTestRecap(): Promise<ActionResult> {
  try {
    const { userId, email } = await requireUser()
    if (!email) throw new UserError("Your account has no email address.")
    const admin = createAdminClient()
    const data = await loadUserData(admin, userId)
    await sendRecap(admin, { id: userId, email }, data, new Date(), true)
    return { ok: true }
  } catch (e) {
    if (e instanceof EmailError) {
      reportError(e, "test recap")
      return { ok: false, error: "The email didn't send. We're looking into it." }
    }
    return fail(e)
  }
}
