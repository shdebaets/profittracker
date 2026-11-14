import { describe, expect, it } from "vitest"
import { alertEmail, isDigestDay, weekKey } from "./alert-digest"

describe("alert digest", () => {
  it("keys by the week's Monday", () => {
    expect(weekKey(new Date("2026-11-16T14:00:00Z"))).toBe("2026-11-16") // Monday
    expect(weekKey(new Date("2026-11-18T14:00:00Z"))).toBe("2026-11-16") // Wednesday
    expect(weekKey(new Date("2026-11-22T14:00:00Z"))).toBe("2026-11-16") // Sunday
  })

  it("sends Monday to Wednesday", () => {
    expect(isDigestDay(new Date("2026-11-16T14:00:00Z"))).toBe(true)
    expect(isDigestDay(new Date("2026-11-19T14:00:00Z"))).toBe(false)
  })

  it("escapes titles in the email", () => {
    const m = alertEmail({ stale: 2, overpriced: 1, staleDays: 60 }, [{ title: "<b>Tee</b>", line: "60+ days" }], "https://x/inventory", "https://x/u")
    expect(m.subject).toBe("2 stale, 1 overpriced: time to reprice?")
    expect(m.html).toContain("&lt;b&gt;Tee&lt;/b&gt;")
  })
})
