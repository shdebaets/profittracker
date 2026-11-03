import { describe, expect, it } from "vitest"
import { listingKey, planImport, type ImportCandidate } from "./plan"
import { fetchPoshmarkCloset, jsonAfter, parsePoshmarkCloset, poshmarkUsername } from "./poshmark"

// Built to match the structure of real closet pages (checked 2026-11-03).
const post = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: "Nike Tech Fleece Hoodie", description: 'Pit to pit 22" {mint}', brand: "Nike", size: "M",
  size_obj: { id: "M", display: "M" }, condition: "uln", price_amount: { val: "65.0" },
  inventory: { status: "available", multi_item: false },
  cover_shot: { path_large: `posts/2026/10/23/${id}/l_x.jpeg`, url: `https://di2ponv0v5otw.cloudfront.net/posts/m_x.jpeg` },
  ...over,
})
const closetPage = (posts: object[], next?: string) =>
  `<html><script>window.__INITIAL_STATE__=${JSON.stringify({
    common: { x: "}{" },
    $_closet: { listingsPostData: { data: posts, more: { total: 3, next_max_id: next, is_next_max_id_present: !!next } } },
  })};(function(){var s;(s=document.currentScript||document.scripts[document.scripts.length-1]).parentNode.removeChild(s);}());</script></html>`

const A = "6adc117618db028b00a1d7e9"
const B = "6ae39b435ac6f2cd42f32233"

describe("Poshmark closet import", () => {
  it("reads a username from what the seller typed", () => {
    expect(poshmarkUsername("@fxfx")).toBe("fxfx")
    expect(poshmarkUsername("https://poshmark.com/closet/some.one_2?availability=available")).toBe("some.one_2")
    expect(poshmarkUsername("not a name")).toBeNull()
    expect(poshmarkUsername("")).toBeNull()
  })

  it("cuts the state JSON out of the page even with braces in strings", () => {
    expect(jsonAfter('x={"a":"}{\\"","b":[1,{"c":2}]};f()', "x=")).toEqual({ a: '}{"', b: [1, { c: 2 }] })
    expect(jsonAfter("nothing here", "x=")).toBeNull()
  })

  it("turns live closet listings into import candidates", () => {
    const page = closetPage([post(A), post(B, { inventory: { status: "sold_out" } }), post("bad", {})], "ENC_next")
    expect(parsePoshmarkCloset(page)).toEqual({
      nextMaxId: "ENC_next",
      listings: [{
        marketplace: "poshmark", externalId: A, url: `https://poshmark.com/listing/Nike-Tech-Fleece-Hoodie-${A}`,
        title: "Nike Tech Fleece Hoodie", description: 'Pit to pit 22" {mint}', priceCents: 6500, brand: "Nike", size: "M",
        condition: "like_new", photoUrl: `https://di2ponv0v5otw.cloudfront.net/posts/2026/10/23/${A}/l_x.jpeg`,
      }],
    })
    expect(parsePoshmarkCloset("<html>blocked</html>")).toBeNull()
  })

  it("follows pages until the last one", async () => {
    const urls: string[] = []
    const fetcher = (async (url: string) => {
      urls.push(url)
      // A was shared while we read, so it shows up on page 2 again.
      const html = url.includes("max_id") ? closetPage([post(B), post(A)]) : closetPage([post(A)], "ENC 2")
      return new Response(html)
    }) as typeof fetch
    const all = await fetchPoshmarkCloset("fxfx", fetcher)
    expect(all.map((c) => c.externalId)).toEqual([A, B])
    expect(urls).toEqual(["https://poshmark.com/closet/fxfx", "https://poshmark.com/closet/fxfx?max_id=ENC%202"])
  })

  it("says why a closet couldn't be read", async () => {
    await expect(fetchPoshmarkCloset("nobody", (async () => new Response("", { status: 404 })) as typeof fetch)).rejects.toMatchObject({ reason: "not_found" })
    await expect(fetchPoshmarkCloset("x", (async () => new Response("<html>captcha</html>")) as typeof fetch)).rejects.toMatchObject({ reason: "blocked" })
  })
})

describe("import plan", () => {
  const c = (marketplace: "poshmark" | "mercari", externalId: string, title: string): ImportCandidate => ({
    marketplace, externalId, title, url: "", description: "", priceCents: null, brand: "", size: "", condition: null, photoUrl: null,
  })

  it("reads listing keys from saved links", () => {
    expect(listingKey("poshmark", `https://poshmark.com/listing/Jacket-${A}`)).toBe(`poshmark:${A}`)
    expect(listingKey("mercari", "https://www.mercari.com/us/item/m12215929581/")).toBe("mercari:m12215929581")
    expect(listingKey("facebook", "https://www.facebook.com/marketplace/item/1")).toBeNull()
    expect(listingKey("poshmark", null)).toBeNull()
  })

  it("skips tracked listings, links matching items, and creates the rest", () => {
    const plan = planImport(
      [
        c("poshmark", A, "Levi's 501 Jeans 32x30"), // already tracked
        c("poshmark", B, "levis 501 jeans 32X30"), // same title as item 1, not on Poshmark yet → link
        c("mercari", "m1", "Levi's 501 Jeans 32x30"), // item 1 already on Mercari, item 2 isn't → link to 2
        c("mercari", "m3", "Levi's 501 Jeans 32x30"), // both matches now on Mercari → create
        c("mercari", "m2", "Vintage Tee"), // sold item doesn't count → create
        c("mercari", "m2", "Vintage Tee"), // duplicate in the batch → ignored
      ],
      {
        items: [
          { id: "1", title: "Levi's 501 Jeans 32x30", status: "inventory" },
          { id: "2", title: "Levi's 501 Jeans 32x30", status: "inventory" },
          { id: "3", title: "Vintage tee", status: "sold" },
        ],
        listings: [
          { item_id: "2", marketplace: "poshmark", external_url: `https://poshmark.com/listing/x-${A}` },
          { item_id: "1", marketplace: "mercari", external_url: null },
        ],
      },
    )
    expect(plan.skip.map((x) => x.externalId)).toEqual([A])
    expect(plan.link.map((x) => [x.candidate.externalId, x.itemId])).toEqual([[B, "1"], ["m1", "2"]])
    expect(plan.create.map((x) => x.externalId)).toEqual(["m3", "m2"])
  })
})
