import { describe, expect, it } from "vitest"
import { halfOffCodes } from "./config"

describe("halfOffCodes", () => {
  it("keeps the three codes in order", () => {
    expect(halfOffCodes(" HALF1, HALF2 ,HALF3 ")).toEqual(["HALF1", "HALF2", "HALF3"])
  })
  it("hides the offer unless all three are set", () => {
    expect(halfOffCodes(undefined)).toEqual([])
    expect(halfOffCodes("HALF1,HALF2")).toEqual([])
    expect(halfOffCodes("A,B,C,D")).toEqual([])
  })
})
