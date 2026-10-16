"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireUser } from "@/lib/supabase/server"
import { mileageDeduction } from "@/lib/profit"
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
})
export type MileageInput = z.input<typeof mileageSchema>

export async function logMileage(input: MileageInput): Promise<ActionResult> {
  try {
    const m = mileageSchema.parse(input)
    const { supabase } = await requireUser()
    const { error } = await supabase.from("expenses").insert({
      kind: "mileage",
      title: `Mileage: ${m.purpose}`,
      category: "Travel",
      miles: m.miles,
      rate_cents: m.rateCents,
      amount_cents: mileageDeduction(m.miles, m.rateCents),
      spent_at: new Date(m.spentAt).toISOString(),
    })
    if (error) throw error
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

const settingsSchema = z.object({
  mileageRateCents: z.number().int().min(0).max(1000),
  defaultReturnDays: z.number().int().min(0).max(365),
})

export async function saveSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  try {
    const s = settingsSchema.parse(input)
    const { supabase, userId } = await requireUser()
    const { error } = await supabase.from("settings").upsert({
      user_id: userId,
      mileage_rate_cents: s.mileageRateCents,
      default_return_days: s.defaultReturnDays,
    })
    if (error) throw error
    return done()
  } catch (e) {
    return fail(e)
  }
}
