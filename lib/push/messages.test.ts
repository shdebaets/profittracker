import { describe, expect, it } from "vitest"
import { recapPush, tripPush } from "./messages"

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
})
