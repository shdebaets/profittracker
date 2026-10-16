import { z } from "zod"

export type ActionResult = { ok: true } | { ok: false; error: string }

export function fail(e: unknown): ActionResult {
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" }
  if (e && typeof e === "object" && "message" in e) return { ok: false, error: String(e.message) }
  return { ok: false, error: "Something went wrong" }
}
