import { afterEach, describe, expect, it, vi } from "vitest"
import { unsubscribeUrl, verifyUnsubscribe } from "./send"

const user = "00000000-0000-4000-8000-000000000001"
const sig = (url: string) => new URL(url).searchParams.get("s")!

describe("unsubscribe links", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("signs and verifies every email kind, including return reminders", () => {
    vi.stubEnv("CRON_SECRET", "test-secret")
    for (const kind of ["recap", "tax", "alerts", "returns"] as const) {
      const url = unsubscribeUrl(user, kind)
      expect(url).toContain(`k=${kind}`)
      expect(verifyUnsubscribe(user, kind, sig(url))).toBe(true)
    }
  })

  it("rejects unknown kinds and a signature made for another kind", () => {
    vi.stubEnv("CRON_SECRET", "test-secret")
    expect(verifyUnsubscribe(user, "everything", sig(unsubscribeUrl(user, "returns")))).toBe(false)
    expect(verifyUnsubscribe(user, "tax", sig(unsubscribeUrl(user, "returns")))).toBe(false)
  })
})
