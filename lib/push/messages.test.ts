import { describe, expect, it } from "vitest"
import { recapPush, taxPush, tripPush } from "./messages"

describe("push copy", () => {
  it("writes the trip note from the spec", () => {
    expect(tripPush(12.4, 868).body).toBe("12.4 mi logged, $8.68 write-off.")
  })
  it("writes the weekly recap, with miles only when there were some", () => {
    expect(recapPush({ profit: 42010, itemsSold: 7, miles: 0, mileageWriteOff: 0 }).body).toBe("This week: $420.10 profit, 7 items sold.")
    expect(recapPush({ profit: 1000, itemsSold: 1, miles: 12.4, mileageWriteOff: 868 }).body).toBe(
      "This week: $10.00 profit, 1 item sold, 12.4 mi logged ($8.68 write-off).",
    )
  })
  it("links the recap push to the week it describes", () => {
    expect(recapPush({ profit: 0, itemsSold: 0, miles: 0, mileageWriteOff: 0 }, "2026-11-15").url).toBe("/recap?week=2026-11-15")
  })
  it("writes the tax reminder with the estimate disclaimer", () => {
    const p = taxPush({ n: 4, due: new Date(2027, 0, 15) }, 41250, 7)
    expect(p.title).toBe("Q4 estimated tax due in 7 days")
    expect(p.body).toBe("Due Jan 15. Set aside about $412.50. Estimate only, not tax advice.")
    expect(taxPush({ n: 4, due: new Date(2027, 0, 15) }, 100, 1).title).toBe("Q4 estimated tax due tomorrow")
  })
})
