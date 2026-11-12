import { describe, expect, it } from "vitest"
import { toAlpha, toModelInput } from "./background"

describe("toModelInput", () => {
  it("lays pixels out channel by channel, scaled by the brightest value and normalized", () => {
    // two pixels: white and black (alpha is ignored)
    const out = toModelInput(new Uint8ClampedArray([255, 255, 255, 0, 0, 0, 0, 255]))
    expect(out).toHaveLength(6)
    expect(out[0]).toBeCloseTo((1 - 0.485) / 0.229) // R, pixel 0
    expect(out[1]).toBeCloseTo(-0.485 / 0.229) // R, pixel 1
    expect(out[2]).toBeCloseTo((1 - 0.456) / 0.224) // G, pixel 0
    expect(out[5]).toBeCloseTo(-0.406 / 0.225) // B, pixel 1
  })

  it("uses the brightest channel value, not 255, so dim photos still normalize", () => {
    const out = toModelInput(new Uint8ClampedArray([100, 50, 0, 255]))
    expect(out[0]).toBeCloseTo((1 - 0.485) / 0.229)
    expect(out[1]).toBeCloseTo((0.5 - 0.456) / 0.224)
  })
})

describe("toAlpha", () => {
  it("stretches the map and clamps the faint ends to fully clear / fully opaque", () => {
    expect([...toAlpha([0.2, 0.25, 0.6, 0.95, 1.2])]).toEqual([0, 0, 91, 219, 255])
  })

  it("doesn't divide by zero on a flat map", () => {
    expect([...toAlpha([0.5, 0.5])]).toEqual([0, 0])
  })
})
