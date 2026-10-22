import { reportError } from "@/lib/errors"

export type ActionResult = { ok: true } | { ok: false; error: string }

/** Every server action's catch: a friendly message for the UI, the raw error to the logs. */
export function fail(e: unknown): ActionResult {
  return { ok: false, error: reportError(e, "action") }
}
