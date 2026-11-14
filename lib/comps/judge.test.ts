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
