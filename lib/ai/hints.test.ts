import { describe, expect, it } from "vitest"
import { aiHintsFrom, ebayCategoryQuery, prefillAspects, readHints } from "./hints"
import type { ListingDraft } from "./listing"

describe("ebayCategoryQuery", () => {
  it("adds the AI's leaf category to the title", () => {
    expect(ebayCategoryQuery("Clothing, Shoes & Accessories > Men > Men's Clothing > Coats", "Patagonia Down Sweater L")).toBe(
      "Coats Patagonia Down Sweater L",
    )
  })
  it("doesn't repeat a leaf the title already has, and falls back to the title", () => {
    expect(ebayCategoryQuery("Toys > Plush", "Squishmallow plush 16in")).toBe("Squishmallow plush 16in")
    expect(ebayCategoryQuery(null, "Lego 10294")).toBe("Lego 10294")
  })
})

describe("prefillAspects", () => {
  const aspects = [
    { name: "Brand", multi: false, freeText: true, values: ["Nike", "Adidas"] },
    { name: "Color", multi: false, freeText: false, values: ["Black", "Blue"] },
    { name: "Size Type", multi: false, freeText: false, values: ["Regular", "Big & Tall"] },
    { name: "Material", multi: true, freeText: true, values: [] },
    { name: "Style", multi: false, freeText: true, values: [] },
  ]
  it("matches names loosely, writes pick-list values eBay's way and skips values eBay doesn't offer", () => {
    expect(
      prefillAspects(aspects, [
        { name: "brand", value: "NIKE" },
        { name: "Color", value: "Purple" },
        { name: "size-type", value: "regular" },
        { name: "Material", value: "Cotton, Polyester" },
      ]),
    ).toEqual({ Brand: "Nike", "Size Type": "Regular", Material: "Cotton, Polyester" })
  })
})

describe("hints", () => {
  it("keeps the platform suggestions from a draft", () => {
    const h = aiHintsFrom({
      category: "Toys > Plush", item_specifics: [], price_note: "", facebook_title: " Squishmallow 16in ",
      mercari_category: ["Toys & Collectibles", " ", "Stuffed animals"], poshmark_category: ["Kids", "Toys"],
    } as unknown as ListingDraft)
    expect(h.mercariCategory).toEqual(["Toys & Collectibles", "Stuffed animals"])
    expect(h.facebookTitle).toBe("Squishmallow 16in")
  })
  it("reads stored hints defensively", () => {
    expect(readHints(null)).toBeNull()
    expect(readHints({ mercariCategory: ["A", 3], specifics: [{ name: "x" }] })).toMatchObject({ mercariCategory: ["A"], specifics: [] })
  })
})
