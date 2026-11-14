// Photo scan for Scan to Comp: Claude looks at one photo of a product (no barcode needed) and says
// what it is and what to search eBay for. The search then goes through the normal comp lookup and
// product picker. Same client setup as the AI listing (lib/ai/listing.ts): small model, forced tool.
import "server-only"
import { z } from "zod"
import { AI_MODEL, AiError } from "@/lib/ai/listing"

export const COMP_PHOTO_DAILY_LIMIT = Number(process.env.COMP_PHOTO_DAILY_LIMIT) || 40

export const photoIdSchema = z.object({
  found: z.boolean(),
  product: z.string().max(160),
  search: z.string().max(100),
  barcode: z.string().regex(/^\d{8,14}$/).nullable().catch(null),
})
export type PhotoId = z.infer<typeof photoIdSchema>

const TOOL = {
  name: "product",
  description: "Say what product the photo shows and how to search eBay for it.",
  input_schema: {
    type: "object",
    properties: {
      found: { type: "boolean", description: "false if you can't tell what product this is." },
      product: { type: "string", description: "The exact product: brand, line, model or set name, size or edition. E.g. 'Pokemon TCG Prismatic Evolutions Elite Trainer Box'." },
      search: { type: "string", description: "3-7 words a reseller would type into eBay to find this exact product. No condition words." },
      barcode: { type: ["string", "null"], description: "The UPC/EAN digits only if a barcode number is clearly readable in the photo, else null." },
    },
    required: ["found", "product", "search", "barcode"],
  },
}

/** `jpegBase64`: the photo as base64 JPEG (no data: prefix). */
export async function identifyFromPhoto(jpegBase64: string) {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) throw new AiError("ANTHROPIC_API_KEY is not set")
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 300,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      system:
        "You identify retail products from photos for a reseller checking eBay prices in a store. Read the packaging, logos and any text. Name the exact product, not a category. If you can't tell, say found: false.",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
            { type: "text", text: "What product is this?" },
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
  const id = photoIdSchema.parse(call?.input)
  return { id, usage: { input: body.usage?.input_tokens ?? 0, output: body.usage?.output_tokens ?? 0 } }
}
