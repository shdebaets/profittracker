import { describe, expect, it } from "vitest"
import { PHOTO_LINK_TTL_SECONDS, photoLink, verifyPhotoLink } from "./photo-links"

const secret = "test-secret"
const origin = "https://profittracker-iye3.vercel.app"
const path = "38f743c3-1844-410f-b8cb-c7681ab54954/11ee03a2-4e98-4acb-b403-f8b5646170ca.jpg"
const now = Date.UTC(2026, 9, 22)

function parts(url: string) {
  const [exp, sig, ...p] = url.slice(`${origin}/api/p/`.length).split("/")
  return { exp, sig, path: p.join("/") }
}

describe("photo links", () => {
  it("verify round-trips", () => {
    const l = parts(photoLink(origin, path, { now, secret }))
    expect(l.path).toBe(path)
    expect(verifyPhotoLink(l.exp, l.sig, l.path, { now, secret })).toBe(true)
  })

  it("stay within eBay's limits: 500 per URL, 3,975 for 12 photos", () => {
    const url = photoLink(origin, path, { now, secret })
    expect(url.length).toBeLessThan(200)
    expect(Array.from({ length: 12 }, () => url).join("").length).toBeLessThan(3975)
  })

  it("expire after 7 days", () => {
    const l = parts(photoLink(origin, path, { now, secret }))
    const later = now + (PHOTO_LINK_TTL_SECONDS + 1) * 1000
    expect(verifyPhotoLink(l.exp, l.sig, l.path, { now: later, secret })).toBe(false)
  })

  it("reject tampering: other photo, changed expiry, other key, bad path", () => {
    const l = parts(photoLink(origin, path, { now, secret }))
    const other = "38f743c3-1844-410f-b8cb-c7681ab54954/00000000-0000-0000-0000-000000000000.jpg"
    expect(verifyPhotoLink(l.exp, l.sig, other, { now, secret })).toBe(false)
    expect(verifyPhotoLink(String(Number(l.exp) + 999999), l.sig, l.path, { now, secret })).toBe(false)
    expect(verifyPhotoLink(l.exp, l.sig, l.path, { now, secret: "other" })).toBe(false)
    expect(verifyPhotoLink(l.exp, l.sig, "../../etc/passwd", { now, secret })).toBe(false)
    expect(verifyPhotoLink(l.exp, "short", l.path, { now, secret })).toBe(false)
  })
})
