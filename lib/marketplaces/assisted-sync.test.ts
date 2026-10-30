import { describe, expect, it, vi } from "vitest"
import { fetchSaleChecks, poshmarkUrl } from "./assisted-sync"

const ID = "6ae39b435ac6f2cd42f32233"
const LINK = `https://poshmark.com/listing/Nike-Jacket-${ID}`
const page = (status: string) => `{"id":"${ID}","inventory":{"status":"${status}"}}`
const reply = (body: string, status = 200) => new Response(body, { status })

describe("poshmarkUrl", () => {
  it("only allows Poshmark listing pages", () => {
    expect(poshmarkUrl(LINK)).toBe(LINK)
    expect(poshmarkUrl(`https://www.poshmark.com/listing/Nike-Jacket-${ID}?src=x`)).toBe(LINK)
    expect(poshmarkUrl(`http://poshmark.com/listing/Nike-Jacket-${ID}`)).toBeNull()
    expect(poshmarkUrl(`https://poshmark.com.evil.test/listing/Nike-Jacket-${ID}`)).toBeNull()
    expect(poshmarkUrl("http://169.254.169.254/latest/meta-data")).toBeNull()
    expect(poshmarkUrl("https://poshmark.com/closet/someone")).toBeNull()
    expect(poshmarkUrl("not a link")).toBeNull()
    expect(poshmarkUrl(null)).toBeNull()
  })
})

describe("fetchSaleChecks", () => {
  const listing = { id: "l1", external_url: LINK }

  it("turns pages into checks", async () => {
    const fetcher = vi.fn(async () => reply(page("sold_out")))
    expect(await fetchSaleChecks([listing], fetcher as typeof fetch)).toEqual({
      checks: [{ listingId: "l1", state: "sold", priceCents: null }],
      blocked: 0,
    })
    expect(fetcher).toHaveBeenCalledWith(LINK, expect.anything())
  })

  it("treats a missing page as taken down", async () => {
    const { checks } = await fetchSaleChecks([listing], (async () => reply("", 404)) as typeof fetch)
    expect(checks).toEqual([{ listingId: "l1", state: "unavailable", priceCents: null }])
  })

  it("changes nothing when blocked, unreadable or failing", async () => {
    for (const fetcher of [
      async () => reply("Forbidden", 403),
      async () => reply("<html>Just a moment...</html>"),
      async () => { throw new Error("timeout") },
    ]) {
      expect(await fetchSaleChecks([listing], fetcher as typeof fetch)).toEqual({ checks: [], blocked: 1 })
    }
  })

  it("never fetches a link that isn't Poshmark", async () => {
    const fetcher = vi.fn(async () => reply(page("sold_out")))
    const out = await fetchSaleChecks([{ id: "l2", external_url: "http://169.254.169.254/" }], fetcher as typeof fetch)
    expect(fetcher).not.toHaveBeenCalled()
    expect(out).toEqual({ checks: [], blocked: 0 })
  })
})
