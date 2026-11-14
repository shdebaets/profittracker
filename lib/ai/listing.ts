// AI listing from photos: Claude looks at the item's photos and drafts the title, description,
// item specifics, category and a suggested price. Kept cheap: a small model, at most 4 photos,
// a short answer, and a per-user daily fair-use cap.
import "server-only"
import { z } from "zod"
import { ITEM_CONDITIONS } from "@/lib/marketplaces/registry"

export const AI_MODEL = process.env.AI_MODEL?.trim() || "claude-haiku-5-5"
export const AI_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 60
export const AI_MAX_PHOTOS = 4

export const listingDraftSchema = z.object({
  title: z.string().max(120),
  description: z.string().max(3000),
  brand: z.string().max(80).nullable(),
  size: z.string().max(40).nullable(),
  condition: z.enum(ITEM_CONDITIONS.map((c) => c.value) as [string, ...string[]]).nullable(),
  category: z.string().max(120),
  item_specifics: z.array(z.object({ name: z.string().max(60), value: z.string().max(120) })).max(15),
  suggested_price_usd: z.number().min(0).max(100000).nullable(),
  price_note: z.string().max(200),
})
export type ListingDraft = z.infer<typeof listingDraftSchema>

const TOOL = {
  name: "listing_draft",
  description: "Return the resale listing drafted from the photos.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "eBay-style title, at most 80 characters: brand, item, key details, size, color. No hype words." },
      description: { type: "string", description: "Plain, honest description: what it is, notable details, any visible flaws. 2-5 short sentences. No emojis." },
      brand: { type: ["string", "null"] },
      size: { type: ["string", "null"] },
      condition: { type: ["string", "null"], enum: [...ITEM_CONDITIONS.map((c) => c.value), null], description: "Best guess from the photos." },
      category: { type: "string", description: "eBay-style category path, e.g. Clothing, Shoes & Accessories > Men > Men's Clothing > Coats" },
      item_specifics: {
        type: "array",
        items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" } }, required: ["name", "value"] },
        description: "eBay item specifics you can see or reasonably infer (Brand, Type, Color, Material, Model, Platform...). Skip ones you'd have to guess.",
      },
      suggested_price_usd: { type: ["number", "null"], description: "Typical used resale price on eBay in USD, or null if you can't tell." },
      price_note: { type: "string", description: "One short line on how sure the price is." },
    },
    required: ["title", "description", "brand", "size", "condition", "category", "item_specifics", "suggested_price_usd", "price_note"],
  },
}

export class AiError extends Error {}

export async function draftListingFromPhotos(imageUrls: string[], hint: string | null) {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) throw new AiError("ANTHROPIC_API_KEY is not set")
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 900,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      system:
        "You write resale listings for eBay, Mercari, Poshmark and Facebook Marketplace from item photos. Be accurate: only state what the photos show or what is standard for that exact product. Never invent flaws, measurements or authenticity claims.",
      messages: [
        {
          role: "user",
          content: [
            ...imageUrls.slice(0, AI_MAX_PHOTOS).map((url) => ({ type: "image", source: { type: "url", url } })),
            { type: "text", text: `Draft the listing for this item.${hint ? ` The seller calls it: "${hint.slice(0, 200)}".` : ""}` },
          ],
        },
      ],
    }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    content?: { type: string; name?: string; input?: unknown }[]
    usage?: { input_tokens?: number; output_tokens?: number }
    error?: { message?: string }
  }
  if (!res.ok) throw new AiError(`Claude ${res.status}: ${body.error?.message ?? ""}`)
  const call = body.content?.find((c) => c.type === "tool_use" && c.name === TOOL.name)
  const draft = listingDraftSchema.parse(call?.input)
  return { draft, usage: { input: body.usage?.input_tokens ?? 0, output: body.usage?.output_tokens ?? 0 } }
}
