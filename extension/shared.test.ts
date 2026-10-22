import { beforeAll, describe, expect, it } from "vitest"

type FLT = {
  facebookCondition(c: string | null): string | null
  facebookPrice(cents: number | null): string
  listingText(l: { description?: string; condition?: string | null; brand?: string; size?: string }): string
  findListingHref(links: { href: string; textContent: string }[], title: string): string | null
  norm(s: string): string
}
let FL: FLT

beforeAll(async () => {
  // shared.js is a classic script that hangs its helpers off globalThis.FL.
  await import("./shared.js")
  FL = (globalThis as unknown as { FL: FLT }).FL
})

describe("extension shared helpers", () => {
  it("maps FlipLedger conditions to Facebook's menu", () => {
    expect(FL.facebookCondition("new_with_tags")).toBe("New")
    expect(FL.facebookCondition("new")).toBe("New")
    expect(FL.facebookCondition("like_new")).toBe("Used - Like New")
    expect(FL.facebookCondition("good")).toBe("Used - Good")
    expect(FL.facebookCondition("fair")).toBe("Used - Fair")
    expect(FL.facebookCondition(null)).toBeNull()
  })

  it("rounds prices to whole dollars", () => {
    expect(FL.facebookPrice(4500)).toBe("45")
    expect(FL.facebookPrice(1250)).toBe("13")
    expect(FL.facebookPrice(null)).toBe("")
  })

  it("builds the description with item facts", () => {
    expect(FL.listingText({ description: " Pit to pit 25in ", condition: "good", brand: "Nike", size: "L" })).toBe(
      "Pit to pit 25in\n\nCondition: Good\nBrand: Nike\nSize: L",
    )
    expect(FL.listingText({ description: "" })).toBe("")
  })

  it("finds the new listing's link by title, ignoring other links", () => {
    const links = [
      { href: "https://www.facebook.com/marketplace/you/selling", textContent: "Vintage Nike Windbreaker" },
      { href: "https://www.facebook.com/marketplace/item/111/?ref=x", textContent: "Levi's 501 Jeans $30" },
      { href: "/marketplace/item/222/?ref=selling", textContent: "Vintage Nike Windbreaker Size L · $45 · Listed just now" },
    ]
    expect(FL.findListingHref(links, "Vintage Nike Windbreaker Size L")).toBe("https://www.facebook.com/marketplace/item/222")
    expect(FL.findListingHref(links, "Something else")).toBeNull()
  })

  it("matches titles Facebook truncated", () => {
    const links = [{ href: "/marketplace/item/333/", textContent: "Super long vintage Nike windbreaker jacket 90s colorblock…" }]
    expect(FL.findListingHref(links, "Super long vintage Nike windbreaker jacket 90s colorblock size L excellent")).toBe(
      "https://www.facebook.com/marketplace/item/333",
    )
  })
})
