import { beforeAll, describe, expect, it } from "vitest"

type FLT = {
  facebookCondition(c: string | null): string | null
  facebookPrice(cents: number | null): string
  listingText(l: { description?: string; condition?: string | null; brand?: string; size?: string }): string
  findListingHref(links: { href: string; textContent: string }[], title: string, pattern?: RegExp, origin?: string): string | null
  norm(s: string): string
  conditionChoices(m: string, c: string | null): string[]
  wholeDollars(cents: number | null): string
  saleStatus(html: string): { state: string; priceCents: number | null }
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

  it("offers condition fallbacks per marketplace", () => {
    expect(FL.conditionChoices("poshmark", "new_with_tags")).toEqual(["New With Tags", "NWT"])
    expect(FL.conditionChoices("poshmark", "new")[0]).toBe("New Without Tags")
    expect(FL.conditionChoices("mercari", "like_new")).toEqual(["Like new"])
    expect(FL.conditionChoices("mercari", null)).toEqual([])
    expect(FL.conditionChoices("depop", "good")).toEqual([])
  })

  it("rounds to whole dollars", () => {
    expect(FL.wholeDollars(2999)).toBe("30")
    expect(FL.wholeDollars(0)).toBe("0")
  })

  it("finds Poshmark and Mercari listing links", () => {
    const posh = [
      { href: "/closet/someone", textContent: "Vintage Nike Windbreaker" },
      { href: "/listing/Vintage-Nike-Windbreaker-L-65a1b2c3d4e5f6a7b8c9d0e1?src=closet", textContent: "Vintage Nike Windbreaker L $45" },
    ]
    expect(FL.findListingHref(posh, "Vintage Nike Windbreaker L", /\/listing\/[^/?#]*-[0-9a-f]{24}/, "https://poshmark.com")).toBe(
      "https://poshmark.com/listing/Vintage-Nike-Windbreaker-L-65a1b2c3d4e5f6a7b8c9d0e1",
    )
    const mercari = [{ href: "https://www.mercari.com/us/item/m12345678901/?ref=mypage", textContent: "Levi's 501 Jeans 32x30" }]
    expect(FL.findListingHref(mercari, "Levi's 501 Jeans 32x30", /\/(us\/)?item\/m\d+/, "https://www.mercari.com")).toBe(
      "https://www.mercari.com/us/item/m12345678901",
    )
  })
})

const ld = (offers: unknown, extra = {}) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "Jacket", offers, ...extra })}</script></head></html>`

describe("saleStatus", () => {
  it("reads sold, live and taken-down listings from schema.org data", () => {
    expect(FL.saleStatus(ld({ "@type": "Offer", price: "45.00", availability: "https://schema.org/SoldOut" }))).toEqual({ state: "sold", priceCents: 4500 })
    expect(FL.saleStatus(ld({ "@type": "Offer", price: 30, availability: "http://schema.org/InStock" }))).toEqual({ state: "available", priceCents: 3000 })
    expect(FL.saleStatus(ld([{ "@type": "Offer", price: "12.5", availability: "OutOfStock" }]))).toEqual({ state: "unavailable", priceCents: 1250 })
  })

  it("handles @graph pages and other JSON-LD blocks", () => {
    const html =
      `<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[]}</script>` +
      `<script type='application/ld+json'>{"@graph":[{"@type":"Organization"},{"@type":"Product","offers":{"price":"20","availability":"https://schema.org/SoldOut"}}]}</script>`
    expect(FL.saleStatus(html)).toEqual({ state: "sold", priceCents: 2000 })
  })

  it("only trusts the listing's own product, not other items on the page", () => {
    const html =
      ld({ "@type": "Offer", price: "45", availability: "https://schema.org/InStock" }) +
      ld({ "@type": "Offer", price: "20", availability: "https://schema.org/SoldOut" }) +
      `<script>{"similar":[{"status":"sold_out"}]}</script>`
    expect(FL.saleStatus(html)).toEqual({ state: "available", priceCents: 4500 })
    // Status fields outside schema.org data are ignored.
    expect(FL.saleStatus(`<script>{"inventory":{"status":"sold_out"}}</script>`).state).toBe("unknown")
  })

  it("says unknown for pages it can't read", () => {
    expect(FL.saleStatus("<html>Just a moment...</html>")).toEqual({ state: "unknown", priceCents: null })
    expect(FL.saleStatus(`<script type="application/ld+json">{not json</script>`).state).toBe("unknown")
    expect(FL.saleStatus("")).toEqual({ state: "unknown", priceCents: null })
  })
})
