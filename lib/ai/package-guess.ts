// Guess a product's shipped weight and box from its name, for the shipping estimate. One small text call.
import "server-only"
import { z } from "zod"
import { AI_MODEL, AiError } from "@/lib/ai/listing"
import { BOX_PRESETS } from "@/lib/shipping/estimate"

export const SHIPPING_KIND = "shipping"

const BOX_IDS = BOX_PRESETS.map((b) => b.id) as [string, ...string[]]

const guessSchema = z.object({
  weight_oz: z.number().min(1).max(20 * 16),
  box: z.enum(BOX_IDS),
})
export type PackageGuess = { weightOz: number; box: (typeof BOX_PRESETS)[number]["id"] }

const TOOL = {
  name: "package_guess",
  description: "The packed weight and the smallest box that fits the product.",
  input_schema: {
    type: "object",
    properties: {
      weight_oz: { type: "number", description: "Packed shipping weight in ounces, including packaging. Round up." },
      box: {
        type: "string",
        enum: BOX_IDS,
        description: BOX_PRESETS.map((b) => `${b.id}: ${b.label} ${b.dims.join("×")} in`).join("; "),
      },
    },
    required: ["weight_oz", "box"],
  },
}

export async function guessPackage(title: string): Promise<{ guess: PackageGuess; usage: { input: number; output: number } }> {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) throw new AiError("ANTHROPIC_API_KEY is not set")
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 200,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      system: "You estimate how much a resale item weighs once packed for shipping and which standard box it fits. Use the typical retail product; err slightly heavy.",
      messages: [{ role: "user", content: `Product: "${title.slice(0, 200)}"` }],
    }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    content?: { type: string; name?: string; input?: unknown }[]
    usage?: { input_tokens?: number; output_tokens?: number }
    error?: { message?: string }
  }
  if (!res.ok) throw new AiError(`Claude ${res.status}: ${body.error?.message ?? ""}`)
  const call = body.content?.find((c) => c.type === "tool_use" && c.name === TOOL.name)
  const g = guessSchema.parse(call?.input)
  return {
    guess: { weightOz: Math.ceil(g.weight_oz), box: g.box as PackageGuess["box"] },
    usage: { input: body.usage?.input_tokens ?? 0, output: body.usage?.output_tokens ?? 0 },
  }
}
