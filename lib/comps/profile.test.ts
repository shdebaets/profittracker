import { describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
import { cleanProfile, editionVerdict, excluded } from "./profile"

const night = "Pokemon TCG 30th Celebration Ultra Premium Collection Night (Umbreon)"

describe("product profile", () => {
  const p = cleanProfile(night, {
    keywords: ["pokemon upc night", "ultra premium collection umbreon", "pokemon upc night", "30th anniversary celebration night", "x"],
    exclusions: ["empty box", "Case Only", "pokemon"],
    edition_words: ["Night", "umbreon"],
    other_editions: [
      { name: "Day", words: ["day", "espeon", "collection"] },
      { name: "", words: ["x"] },
    ],
  })

  it("cleans keywords: the cut-down phrase first, no repeats or one-word searches, at most 10", () => {
    expect(p.keywords[0]).toBe("Pokemon 30th Ultra Premium Collection Night")
    expect(p.keywords).toContain("ultra premium collection umbreon")
    expect(p.keywords.filter((k) => k === "pokemon upc night")).toHaveLength(1)
    expect(p.keywords).not.toContain("x")
    const many = cleanProfile(night, { keywords: Array.from({ length: 20 }, (_, i) => `upc night ${i}`) })
    expect(many.keywords).toHaveLength(10)
  })

  it("drops exclusions the product's own name has and sibling words this product uses", () => {
    expect(p.exclusions).toEqual(["empty box", "case only"])
    expect(p.otherEditions).toEqual([{ name: "Day", words: ["day", "espeon"] }])
  })

  it("rules out other editions and mixed listings by whole words", () => {
    expect(editionVerdict("Pokemon 30th Celebration UPC Night Umbreon Sealed", p)).toBe("keep")
    expect(editionVerdict("Pokemon 30th Celebration UPC Day Espeon", p)).toBe("other")
    expect(editionVerdict("Pokemon UPC Day and Night Bundle", p)).toBe("mixed")
    // "Holiday" contains "day" but isn't the word.
    expect(editionVerdict("Pokemon UPC Night Holiday Gift", p)).toBe("keep")
    expect(excluded("Pokemon UPC Night EMPTY BOX only", p)).toBe(true)
    expect(excluded("Pokemon UPC Night sealed", p)).toBe(false)
  })

  it("falls back to the plain phrase without the AI", () => {
    expect(cleanProfile(night, null)).toEqual({
      keywords: ["Pokemon 30th Ultra Premium Collection Night"],
      exclusions: [],
      editionWords: [],
      otherEditions: [],
    })
  })
})
