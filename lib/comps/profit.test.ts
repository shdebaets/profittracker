import { describe, expect, it } from "vitest"
import { feeText, platformProfit, PROFIT_PLATFORMS, profitPlatform } from "./profit"
import { buyProfit } from "./stats"

describe("profit per platform", () => {
  it("lists the registry's marketplaces, eBay first", () => {
    expect(PROFIT_PLATFORMS[0].id).toBe("ebay")
    expect(PROFIT_PLATFORMS.map((p) => p.id)).toEqual(expect.arrayContaining(["mercari", "poshmark", "facebook", "depop", "vinted"]))
    expect(profitPlatform("nope").id).toBe("ebay")
  })
  it("eBay: 13.25% fee and a $6 label, same as buyProfit", () => {
    expect(platformProfit(1000, 4000)).toEqual({ profit: 4000 - 530 - 600 - 1000, fees: 530, label: 600, roi: 1.87 })
    expect(platformProfit(1000, 4000).profit).toBe(buyProfit(1000, 4000).profit)
  })
  it("Mercari and Depop: 10%", () => {
    expect(platformProfit(1000, 4000, "mercari").fees).toBe(400)
    expect(platformProfit(1000, 4000, "depop").profit).toBe(4000 - 400 - 600 - 1000)
  })
  it("Poshmark: 15%", () => {
    expect(platformProfit(1000, 4000, "poshmark").fees).toBe(600)
  })
  it("Facebook and Vinted (cash preset): no fee, label as entered", () => {
    expect(platformProfit(1000, 4000, "facebook", 0)).toMatchObject({ fees: 0, profit: 3000 })
    expect(platformProfit(1000, 4000, "vinted", 850).profit).toBe(2150)
  })
  it("never takes a negative label", () => {
    expect(platformProfit(1000, 4000, "facebook", -500).profit).toBe(3000)
  })
  it("describes fees", () => {
    expect(feeText(profitPlatform("ebay"))).toBe("13.25%")
    expect(feeText(profitPlatform("facebook"))).toBe("no fee")
  })
})
