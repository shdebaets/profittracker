import { describe, expect, it } from "vitest"
import { installPlatform, isDismissed, SNOOZE_DAYS } from "./install"

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1"
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15"
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

describe("installPlatform", () => {
  it("tells iPhone Safari from other iPhone browsers", () => {
    expect(installPlatform(IPHONE_SAFARI)).toBe("ios-safari")
    expect(installPlatform(IPHONE_CHROME)).toBe("ios-other")
  })
  it("treats an iPad (Mac user agent with touch) as iOS, a Mac as desktop", () => {
    expect(installPlatform(IPAD, 5)).toBe("ios-safari")
    expect(installPlatform(IPAD, 0)).toBe("desktop")
    expect(installPlatform(MAC_CHROME, 0)).toBe("desktop")
  })
  it("spots Android", () => {
    expect(installPlatform(ANDROID, 5)).toBe("android")
  })
})

describe("isDismissed", () => {
  const now = Date.UTC(2026, 10, 25)
  it("is shown when nothing is stored or the value is junk", () => {
    expect(isDismissed(null, now)).toBe(false)
    expect(isDismissed("", now)).toBe(false)
    expect(isDismissed("abc", now)).toBe(false)
  })
  it("stays hidden for good after Done", () => {
    expect(isDismissed("never", now)).toBe(true)
  })
  it("Not now hides it for 7 days", () => {
    const day = 86_400_000
    expect(isDismissed(String(now - day), now)).toBe(true)
    expect(isDismissed(String(now - (SNOOZE_DAYS * day - 1)), now)).toBe(true)
    expect(isDismissed(String(now - SNOOZE_DAYS * day), now)).toBe(false)
  })
})
