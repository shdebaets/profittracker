import { describe, expect, it } from "vitest"
import { returnsPush } from "@/lib/push/messages"
import { returnsEmail } from "@/lib/email/templates"
import { returnsDue } from "./reminders"

const now = new Date(2026, 10, 20, 9) // Nov 20, 2026, local time
const item = (o: Partial<Parameters<typeof returnsDue>[0][number]>) => ({
  status: "inventory" as const, returnable: true, return_deadline: "2026-11-23", title: "Nike Dunk", seq: 1, quantity: 1, ...o,
})

describe("returnsDue", () => {
  it("picks unsold returnable items 3 days and 1 day out, soonest first", () => {
    const due = returnsDue([
      item({ title: "Lego Set", return_deadline: "2026-11-21" }),
      item({ title: "Nike Dunk", return_deadline: "2026-11-23" }),
      item({ title: "Two days", return_deadline: "2026-11-22" }),
      item({ title: "Today", return_deadline: "2026-11-20" }),
      item({ title: "Past", return_deadline: "2026-11-19" }),
    ], now)
    expect(due.map((d) => [d.title, d.daysLeft])).toEqual([["Lego Set", 1], ["Nike Dunk", 3]])
  })

  it("skips sold, returned, non-returnable and undated items", () => {
    expect(returnsDue([
      item({ status: "sold" }),
      item({ status: "returned" }),
      item({ returnable: false }),
      item({ return_deadline: null }),
    ], now)).toEqual([])
  })

  it("merges rows split by a partial sale and names untitled items", () => {
    const due = returnsDue([item({ quantity: 2 }), item({ title: "nike dunk ", quantity: 3, seq: 2 }), item({ title: null, seq: 7 })], now)
    expect(due).toEqual([
      { title: "Item #7", deadline: "2026-11-23", daysLeft: 3, units: 1 },
      { title: "Nike Dunk", deadline: "2026-11-23", daysLeft: 3, units: 5 },
    ])
  })
})

describe("return reminder copy", () => {
  const one = [{ title: "Nike Dunk", deadline: "2026-11-21", daysLeft: 1, units: 1 }]
  const three = [...one, { title: "Lego", deadline: "2026-11-23", daysLeft: 3, units: 2 }, { title: "Hat", deadline: "2026-11-23", daysLeft: 3, units: 1 }]

  it("writes the push and opens the Returns filter", () => {
    expect(returnsPush(one)).toEqual({ title: "Return window closing", body: "Nike Dunk (1 day left).", url: "/inventory?filter=returns", tag: "returns" })
    expect(returnsPush(three).title).toBe("3 return windows closing")
    expect(returnsPush(three).body).toBe("Nike Dunk (1 day left), +2 more.")
  })

  it("writes the email, escaping titles", () => {
    expect(returnsEmail(one, "https://x/inventory", "https://x/unsub").subject).toBe("Return window closing: Nike Dunk (1 day left)")
    const m = returnsEmail([...three, { title: "<b>Shoes</b>", deadline: "2026-11-23", daysLeft: 3, units: 1 }], "https://x/inventory", "https://x/unsub")
    expect(m.subject).toBe("4 return windows closing, the first in 1 day")
    expect(m.html).toContain("Lego (×2)")
    expect(m.html).toContain("&lt;b&gt;Shoes&lt;/b&gt;")
    expect(m.html).toContain("https://x/unsub")
  })
})
