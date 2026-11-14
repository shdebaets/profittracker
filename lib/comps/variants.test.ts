import { describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
import { mergeSearches } from "./variants"

describe("mergeSearches", () => {
  it("starts with the cut-down name, adds the AI's searches, drops repeats and one-word searches", () => {
    expect(
      mergeSearches("Godzilla Minus Zero AMC Exclusive Popcorn Bucket", [
        "AMC Godzilla Minus Zero Bucket",
        "godzilla minus zero amc exclusive popcorn bucket",
        "Bucket",
        "Godzilla popcorn bucket AMC",
        "Godzilla Minus One bucket",
      ]),
    ).toEqual(["Godzilla Minus Zero AMC Exclusive Popcorn Bucket", "AMC Godzilla Minus Zero Bucket", "Godzilla popcorn bucket AMC"])
  })
  it("works with no AI answer", () => {
    expect(mergeSearches("Pokémon TCG 30th Celebration Ultra Premium Collection Night (Umbreon)", null)).toEqual(["Pokemon 30th Ultra Premium Collection Night"])
  })
})
