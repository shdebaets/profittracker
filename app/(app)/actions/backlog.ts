"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { UserError } from "@/lib/errors"
import { sheetCsvUrl } from "@/lib/backlog/parse"
import { EXPENSE_CATEGORIES } from "@/lib/types"
import { requireMember } from "@/lib/supabase/server"
import { fail } from "./result"

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

const MAX_SHEET_BYTES = 5 * 1024 * 1024
/** Rows per call: server actions accept about 1MB. The browser sends batches this size. */
const MAX_BATCH = 200

/**
 * Read a Google Sheet shared as "Anyone with the link" as CSV text. Only ever fetches
 * docs.google.com: the export link is built from the sheet's ID, not used as typed.
 */
export async function fetchGoogleSheet(link: string): Promise<Result<string>> {
  try {
    await requireMember()
    const url = sheetCsvUrl(String(link).slice(0, 500))
    if (!url) throw new UserError("That isn't a Google Sheets link. Open the sheet and copy the link from the address bar.")
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "follow" })
    const type = res.headers.get("content-type") ?? ""
    if (res.status === 404) throw new UserError("Couldn't find that sheet. Check the link.")
    if (!res.ok || !type.includes("text/csv")) {
      // Private sheets redirect to Google's sign-in page.
      throw new UserError("FlipLedger can't open that sheet. In Google Sheets, click Share → General access → \"Anyone with the link\", then try again.")
    }
    const reader = res.body?.getReader()
    if (!reader) throw new UserError("That sheet came back empty.")
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_SHEET_BYTES) {
        await reader.cancel()
        throw new UserError("That sheet is too big to import at once (over 5MB). Split it into a few sheets.")
      }
      chunks.push(value)
    }
    return { ok: true, data: new TextDecoder().decode(Buffer.concat(chunks)) }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

const cents = z.number().int().min(0).max(100_000_000)
const iso = z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), "Not a date")
const optText = (max: number) => z.string().max(max).nullable()
const ref = z.string().regex(/^(item|expense|mileage):[0-9a-z]{4,60}$/)
const batchId = z.uuid()

const itemSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    status: z.enum(["inventory", "sold", "returned"]),
    quantity: z.number().int().min(1).max(100_000),
    cost_cents: cents,
    cost_unknown: z.boolean(),
    purchased_at: iso,
    store: optText(100),
    link_url: optText(1000).refine((u) => u === null || /^https?:\/\//i.test(u), "Not a link"),
    description: optText(5000),
    brand: optText(100),
    size: optText(50),
    category: optText(200),
    list_price_cents: cents.nullable(),
    sale_price_cents: cents.nullable(),
    buyer_shipping_cents: cents,
    label_cost_cents: cents,
    fee_pct: z.number().min(0).max(0.5),
    fee_fixed_cents: cents,
    sales_tax_cents: cents,
    platform: z.enum(["cash", "card", "mercari_depop", "ebay", "poshmark_amz", "facebook", "custom"]).nullable(),
    sold_on: z.enum(["ebay", "mercari", "facebook", "depop", "vinted", "poshmark", "etsy"]).nullable(),
    sold_at: iso.nullable(),
    shipped_at: iso.nullable(),
    import_ref: ref,
  })
  .refine((i) => i.status !== "sold" || (i.sold_at !== null && i.sale_price_cents !== null && i.platform !== null), "A sale needs a date, price and platform")
  .transform((i) =>
    i.status === "sold"
      ? i
      : { ...i, sale_price_cents: null, sold_at: null, shipped_at: null, platform: null, sold_on: null, fee_pct: 0, fee_fixed_cents: 0, buyer_shipping_cents: 0, label_cost_cents: 0, sales_tax_cents: 0 },
  )

const expenseSchema = z.object({
  kind: z.enum(["expense", "mileage"]),
  title: z.string().trim().min(1).max(200),
  category: z.enum(EXPENSE_CATEGORIES),
  amount_cents: cents,
  spent_at: iso,
  miles: z.number().positive().max(10_000).nullable(),
  rate_cents: z.number().int().min(0).max(1000).nullable(),
  import_ref: ref,
})

type Saved = { added: number; skipped: number }
type SupabaseClient = Awaited<ReturnType<typeof requireMember>>["supabase"]

/** Insert rows whose import_ref isn't in the table yet. RLS scopes everything to this user. */
async function insertNew<T extends { import_ref: string }>(
  supabase: SupabaseClient, table: "items" | "expenses", batch: string, rows: T[],
): Promise<Saved> {
  if (!rows.length) return { added: 0, skipped: 0 }
  const { data: existing, error: readErr } = await supabase.from(table).select("import_ref").in("import_ref", rows.map((r) => r.import_ref))
  if (readErr) throw readErr
  const have = new Set((existing ?? []).map((r) => r.import_ref))
  const fresh = rows.filter((r) => !have.has(r.import_ref)).map((r) => ({ ...r, import_batch: batch }))
  if (fresh.length) {
    const { error } = await supabase.from(table).insert(fresh)
    if (error) {
      // 23505: the same rows are being imported in another tab right now.
      if (error.code === "23505") throw new UserError("These rows are already being imported. Refresh in a moment to see them.")
      throw error
    }
  }
  return { added: fresh.length, skipped: rows.length - fresh.length }
}

/** Save one batch of mapped spreadsheet rows as items. Rows already imported are skipped. */
export async function importBacklogItems(batch: string, input: unknown[]): Promise<Result<Saved>> {
  try {
    const id = batchId.parse(batch)
    const rows = z.array(itemSchema).max(MAX_BATCH).parse(input)
    const { supabase } = await requireMember()
    const saved = await insertNew(supabase, "items", id, rows)
    revalidatePath("/", "layout")
    return { ok: true, data: saved }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

/** Save one batch of mapped spreadsheet rows as expenses and mileage. */
export async function importBacklogExpenses(batch: string, input: unknown[]): Promise<Result<Saved>> {
  try {
    const id = batchId.parse(batch)
    const rows = z.array(expenseSchema).max(MAX_BATCH).parse(input)
    const { supabase } = await requireMember()
    const saved = await insertNew(supabase, "expenses", id, rows)
    revalidatePath("/", "layout")
    return { ok: true, data: saved }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

const chunks = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n))

/**
 * Remove what one import added. Items changed since (cost added, sold, listed) stay, so
 * undoing never loses work done after the import; expenses are removed as imported.
 */
export async function undoBacklogImport(batch: string): Promise<Result<{ removed: number; kept: number }>> {
  try {
    const id = batchId.parse(batch)
    const { supabase } = await requireMember()

    const { data: items, error } = await supabase.from("items").select("id, created_at, updated_at").eq("import_batch", id)
    if (error) throw error
    const untouched = (items ?? []).filter((i) => Date.parse(i.updated_at) - Date.parse(i.created_at) < 2000).map((i) => i.id)
    const listed = new Set<string>()
    for (const part of chunks(untouched, MAX_BATCH)) {
      const { data, error: lErr } = await supabase.from("marketplace_listings").select("item_id").in("item_id", part)
      if (lErr) throw lErr
      for (const l of data ?? []) listed.add(l.item_id)
    }
    const remove = untouched.filter((i) => !listed.has(i))
    for (const part of chunks(remove, MAX_BATCH)) {
      const { error: dErr } = await supabase.from("items").delete().in("id", part)
      if (dErr) throw dErr
    }

    const { count, error: eErr } = await supabase.from("expenses").delete({ count: "exact" }).eq("import_batch", id)
    if (eErr) throw eErr

    revalidatePath("/", "layout")
    return { ok: true, data: { removed: remove.length + (count ?? 0), kept: (items?.length ?? 0) - remove.length } }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}
