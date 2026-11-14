import { describe, expect, it } from "vitest"
import { badgePush } from "./badge-messages"

describe("badgePush", () => {
  it("names the place, board and month", () => {
    const m = badgePush({ year: 2026, month: 9, board: "itemsSold", place: 2 })
    expect(m.title).toBe("🥈 #2 in Items sold")
    expect(m.body).toContain("October items sold leaderboard")
    expect(m.url).toBe("/leaderboard")
  })
})
