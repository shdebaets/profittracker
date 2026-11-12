import { beforeAll, describe, expect, it } from "vitest"
import { parsePoshSettings, poshTasks, poshUsername, POSH_DEFAULTS } from "@/lib/extension"

type Counts = { day: string; shares: number; offers: number; offered: string[] }
type Posh = {
  MAX_SHARES: number
  MAX_OFFERS: number
  delayMs(rand?: () => number): number
  dayKey(d?: Date): string
  counts(stored: unknown, day: string): Counts
  cap(kind: "shares" | "offers", wanted: unknown): number
  remaining(c: Counts, kind: "shares" | "offers", wanted: unknown): number
  bump(c: Counts, kind: "shares" | "offers", listingId?: string): Counts
  offerCents(price: number | null, percent: number, floor: number): number | null
  stopReason(p: { pathname: string; text?: string; captcha?: boolean; username?: string; expect?: "closet" | "listing" }): string | null
  username(s: string): string
}
let P: Posh

beforeAll(async () => {
  // shared.js is a classic script that hangs its helpers off globalThis.FL.
  await import("./shared.js")
  P = (globalThis as unknown as { FL: { posh: Posh } }).FL.posh
})

describe("Poshmark Assistant offer price", () => {
  it("takes the percent off and rounds down to whole dollars", () => {
    expect(P.offerCents(4000, 20, 0)).toBe(3200)
    expect(P.offerCents(4500, 15, 0)).toBe(3800) // 38.25 → 38
    expect(P.offerCents(1999, 10, 0)).toBe(1700) // 17.99 → 17
  })

  it("never goes under the floor", () => {
    expect(P.offerCents(4000, 50, 2500)).toBe(2500) // 20 would be under 25
    expect(P.offerCents(4000, 50, 2550)).toBe(2600) // floor rounds up to a whole dollar
    expect(P.offerCents(4000, 20, 1000)).toBe(3200) // floor below the offer changes nothing
  })

  it("skips when the floor leaves less than Poshmark's 10% minimum", () => {
    expect(P.offerCents(4000, 20, 3700)).toBeNull() // 37 is only 7.5% off
    expect(P.offerCents(4000, 20, 3600)).toBe(3600) // exactly 10% off is fine
    expect(P.offerCents(500, 10, 0)).toBe(400) // 4.50 → 4
    expect(P.offerCents(100, 10, 0)).toBeNull() // $0.90 rounds to $0
  })

  it("rejects nonsense", () => {
    expect(P.offerCents(null, 20, 0)).toBeNull()
    expect(P.offerCents(0, 20, 0)).toBeNull()
    expect(P.offerCents(4000, 0, 0)).toBeNull()
    expect(P.offerCents(4000, 100, 0)).toBeNull()
    expect(P.offerCents(4000, NaN, 0)).toBeNull()
  })
})

describe("Poshmark Assistant daily caps", () => {
  const day = "2026-11-12"

  it("starts at zero on a new day or with nothing stored", () => {
    expect(P.counts(null, day)).toEqual({ day, shares: 0, offers: 0, offered: [] })
    expect(P.counts({ day: "2026-11-11", shares: 300, offers: 50, offered: ["a"] }, day)).toEqual({ day, shares: 0, offers: 0, offered: [] })
    expect(P.counts({ day, shares: "x", offers: -3, offered: "nope" }, day)).toEqual({ day, shares: 0, offers: 0, offered: [] })
  })

  it("keeps today's counts", () => {
    expect(P.counts({ day, shares: 12, offers: 3, offered: ["a", 7, "b"] }, day)).toEqual({ day, shares: 12, offers: 3, offered: ["a", "b"] })
  })

  it("never lets the seller's cap go over 300 shares or 50 offers", () => {
    expect(P.cap("shares", 1000)).toBe(300)
    expect(P.cap("offers", 1000)).toBe(50)
    expect(P.cap("shares", 120)).toBe(120)
    expect(P.cap("offers", 0)).toBe(0)
    expect(P.cap("shares", undefined)).toBe(300)
    expect(P.cap("offers", -5)).toBe(50)
  })

  it("counts what's left and stops at the cap", () => {
    let c = P.counts(null, day)
    expect(P.remaining(c, "shares", 2)).toBe(2)
    c = P.bump(c, "shares")
    c = P.bump(c, "shares")
    expect(c.shares).toBe(2)
    expect(P.remaining(c, "shares", 2)).toBe(0)
    expect(P.remaining(c, "shares", undefined)).toBe(298)
    expect(P.remaining({ ...c, shares: 400 }, "shares", 300)).toBe(0)
  })

  it("remembers which listings got an offer today", () => {
    const c = P.bump(P.bump(P.counts(null, day), "offers", "abc"), "offers", "def")
    expect(c).toEqual({ day, shares: 0, offers: 2, offered: ["abc", "def"] })
    expect(P.remaining(c, "offers", 50)).toBe(48)
  })

  it("uses the seller's local day", () => {
    expect(P.dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05")
    expect(P.dayKey(new Date(2026, 10, 12, 0, 1))).toBe("2026-11-12")
  })
})

describe("Poshmark Assistant pacing and stops", () => {
  it("waits 3 to 8 seconds between actions", () => {
    expect(P.delayMs(() => 0)).toBe(3000)
    expect(P.delayMs(() => 0.5)).toBe(5500)
    expect(P.delayMs(() => 0.999999)).toBe(8000)
    for (let i = 0; i < 200; i++) {
      const ms = P.delayMs()
      expect(ms).toBeGreaterThanOrEqual(3000)
      expect(ms).toBeLessThanOrEqual(8000)
    }
  })

  const closet = { pathname: "/closet/closetqueen", username: "closetqueen", expect: "closet" as const }

  it("carries on in the seller's own closet and listings", () => {
    expect(P.stopReason({ ...closet, text: "Shared to your followers" })).toBeNull()
    expect(P.stopReason({ ...closet, pathname: "/closet/ClosetQueen/" })).toBeNull()
    expect(P.stopReason({ pathname: "/listing/Nike-Hoodie-64a1b2c3d4e5f6a7b8c9d0e1", expect: "listing" })).toBeNull()
  })

  it("stops on a captcha", () => {
    expect(P.stopReason({ ...closet, captcha: true })).toMatch(/captcha/)
    expect(P.stopReason({ ...closet, text: "Please complete the CAPTCHA" })).toMatch(/captcha/)
    expect(P.stopReason({ ...closet, text: "Verify you are human" })).toMatch(/captcha/)
  })

  it("stops when Poshmark pushes back", () => {
    expect(P.stopReason({ ...closet, text: "Whoa, slow down! You're sharing too fast." })).toMatch(/slow down/)
    expect(P.stopReason({ ...closet, text: "Too many requests" })).toMatch(/slow down/)
    expect(P.stopReason({ ...closet, text: "Something went wrong. Please try again later." })).toMatch(/slow down/)
  })

  it("stops on a login page", () => {
    expect(P.stopReason({ ...closet, pathname: "/login" })).toMatch(/logged in/)
    expect(P.stopReason({ ...closet, text: "Log in to continue" })).toMatch(/logged in/)
  })

  it("stops on any page it didn't expect", () => {
    expect(P.stopReason({ ...closet, pathname: "/closet/someoneelse" })).toMatch(/isn't your closet/)
    expect(P.stopReason({ ...closet, pathname: "/feed" })).toMatch(/isn't your closet/)
    expect(P.stopReason({ ...closet, username: "" })).toMatch(/isn't your closet/)
    expect(P.stopReason({ pathname: "/closet/closetqueen", expect: "listing" })).toMatch(/isn't one of your listings/)
  })

  it("cleans up a typed username", () => {
    expect(P.username(" @closetqueen ")).toBe("closetqueen")
    expect(P.username("https://poshmark.com/closet/closet_queen.22?availability=available")).toBe("closet_queen.22")
    expect(P.username("two words")).toBe("")
    expect(P.username("")).toBe("")
  })
})

describe("app-side Poshmark Assistant settings", () => {
  it("matches the extension's username rule", () => {
    for (const s of [" @closetqueen ", "https://poshmark.com/closet/closet_queen.22?x=1", "two words", "", "a/b"]) {
      expect(poshUsername(s)).toBe(P.username(s))
    }
  })

  it("is all off by default and survives junk in storage", () => {
    expect(parsePoshSettings(null)).toEqual(POSH_DEFAULTS)
    expect(parsePoshSettings("{not json")).toEqual(POSH_DEFAULTS)
    expect(parsePoshSettings(JSON.stringify({ shareCloset: "yes", offerPercent: 5, shareCap: 9999, offerCap: 80 }))).toEqual({
      ...POSH_DEFAULTS, offerPercent: 10, shareCap: 300, offerCap: 50,
    })
  })

  it("runs the switched-on jobs in order", () => {
    expect(poshTasks(POSH_DEFAULTS)).toEqual([])
    expect(poshTasks({ ...POSH_DEFAULTS, offerLikers: true, shareCloset: true })).toEqual(["SHARE_CLOSET", "OFFER_LIKERS"])
  })
})
