import { describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }))
vi.mock("@/lib/ai/listing", () => ({ AI_MODEL: "x" }))
import { obviousMulti } from "./judge"

const night = "Pokemon TCG 30th Celebration Ultra-Premium Collection Night"
describe("obviousMulti", () => {
  it("catches lots, cases and mixes", () => {
    for (const t of [
      "Pokémon TCG 30th Celebration Ultra Premium Collection UPC Day & Night Lot SEALED",
      "Pokemon TCG 30th Celebration UPC COMBO DAY & NIGHT ✅ Ultra Premium Collection",
      "Pokemon TCG 30th Celebration Ultra-Premium Collection Day Night 4 Box Case",
      "POKEMON TCG 30th CELEBRATION ULTRA PREMIUM COLLECTION X2 NIGHT & DAY SET UPC",
      "2 Pokemon TCG 30th Celebration Ultra Premium Collection Day & Night Bundle New",
    ])
      expect(obviousMulti(t, night)).toBe(true)
  })
  it("keeps single units", () => {
    for (const t of [
      "Pokémon TCG 30th Celebration Ultra-Premium Collection – Night (Umbreon)",
      "IN HAND Pokémon TCG 30th Celebration UPC Night Ultra Premium Collection Box 2026",
      "Pokémon TCG | 30th Celebration Ultra Premium Collection Night | Fast Shipping ✅️",
    ])
      expect(obviousMulti(t, night)).toBe(false)
  })
})

const velaris = "ACOTAR Velaris Plush Raschel Throw 50x60"
describe("obviousMulti on throws", () => {
  it("catches multi-packs and two designs together", () => {
    for (const t of [
      "x3 Sarah J Maas ACOTAR Raschel Throw blanket 50x60 The Bat Boys, Velaris, Stars!",
      "Sarah J Maas ACOTAR The Bat Boys & Velaris Throw Blanket 50x60 Plush New Gift",
      "All 3 Stars Who Listen, Bat Boy And Velaris Throw Blanket 50 x 60 in From Walmat",
      "ACOTAR Velaris Throw Set of 2 50x60",
    ])
      expect(obviousMulti(t, velaris)).toBe(true)
  })
  it("doesn't mistake sizes for counts", () => {
    for (const t of [
      "Sarah J. Maas ACOTAR Velaris Plush Throw Blanket 50x60 Polyester",
      "Sarah J Maas ACOTAR Velaris Plush Raschel Throw 50\"x60\" [Officially Licensed]",
      "ACOTAR Velaris Royal Plush Raschel Throw 50 x 60 New",
    ])
      expect(obviousMulti(t, velaris)).toBe(false)
  })
})
