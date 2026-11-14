import { describe, expect, it } from "vitest"
import { alertPush, alertSummary, hasAlerts } from "./alert-messages"

describe("alert digest push", () => {
  it("names both counts", () => {
    const p = alertPush({ stale: 4, overpriced: 2, staleDays: 60 })
    expect(p.title).toBe("4 stale, 2 overpriced")
    expect(p.body).toBe("4 items have sat 60+ days and 2 are priced 25%+ over recent sales. Reprice them in one go?")
    expect(p.url).toBe("/inventory?filter=stale")
  })

  it("singular and one-sided", () => {
    expect(alertSummary({ stale: 0, overpriced: 1, staleDays: 45 })).toBe("1 is priced 25%+ over recent sales")
    expect(alertPush({ stale: 0, overpriced: 1, staleDays: 45 }).url).toBe("/inventory")
    expect(alertSummary({ stale: 1, overpriced: 0, staleDays: 30 })).toBe("1 item has sat 30+ days")
  })

  it("nothing to say", () => expect(hasAlerts({ stale: 0, overpriced: 0, staleDays: 60 })).toBe(false))
})
