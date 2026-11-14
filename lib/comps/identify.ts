// CompAmp's product identification: a loose search ("pokemon upc") covers many different products,
// so a small Claude model groups the live listings into the distinct products a reseller would buy,
// and the seller picks one. Comps are then judged against that exact product.
import "server-only"
import { AI_MODEL } from "@/lib/ai/listing"
import type { ActiveComp } from "./stats"

export type ProductCandidate = { name: string; image: string | null; lowCents: number | null; highCents: number | null; count: number }

const TOOL = {
  name: "products",
  description: "Return the distinct products in these listings.",
  input_schema: {
    type: "object",
    properties: {
      products: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Exact product name: brand, line, edition, size or model. Short, no seller words." },
            listings: { type: "array", items: { type: "integer" }, description: "Indices of single-unit listings of exactly this product." },
          },
          required: ["name", "listings"],
        },
      },
    },
    required: ["products"],
  },
}

const SYSTEM = `You group eBay listings into the distinct physical products a reseller would buy and resell.
A product is one specific item (a specific set, SKU, edition, model, size), not a category.
Only count single units of the product: leave out lots, bundles, accessories, cases, empty boxes, parts and other junk.
Return at most 6 products, most listings first.`

export async function identifyProducts(query: string, comps: ActiveComp[]): Promise<ProductCandidate[]> {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key || comps.length < 2) return []
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 800,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Search: ${query.slice(0, 120)}\nListings (index: title | price):\n${comps
            .slice(0, 100)
            .map((c, i) => `${i}: ${c.title.slice(0, 120)} | $${((c.priceCents + (c.shippingCents ?? 0)) / 100).toFixed(0)}`)
            .join("\n")}`,
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`Claude ${res.status}`)
  const body = (await res.json()) as { content?: { type: string; input?: { products?: { name?: unknown; listings?: unknown }[] } }[] }
  const products = body.content?.find((c) => c.type === "tool_use")?.input?.products ?? []
  return products
    .flatMap((p) => {
      const name = typeof p.name === "string" ? p.name.trim().slice(0, 120) : ""
      const picks = (Array.isArray(p.listings) ? p.listings : []).filter((n): n is number => Number.isInteger(n)).map((n) => comps[n]).filter(Boolean)
      if (!name || !picks.length) return []
      const prices = picks.filter((c) => c.buyItNow).map((c) => c.priceCents + (c.shippingCents ?? 0)).sort((a, b) => a - b)
      return [{
        name,
        image: picks.find((c) => c.image)?.image ?? null,
        lowCents: prices[0] ?? null,
        highCents: prices.at(-1) ?? null,
        count: picks.length,
      }]
    })
    .slice(0, 6)
}
