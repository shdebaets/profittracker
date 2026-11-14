import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseHTML } from "linkedom"
import { describe, expect, it } from "vitest"
import { collectSoldPage, ebaySoldUrl } from "./collect-sold"

const card = (id: string, title: string, price: string, sold: string, ship: string, strike = false) => `
  <li class="s-card">
    <a href="https://www.ebay.com/itm/${id}?x=1"><span class="s-card__title">${title}</span></a>
    <span class="s-card__caption">Sold ${sold}</span>
    <span class="s-card__subtitle">Brand New</span>
    <span class="s-card__price${strike ? " strikethrough" : ""}">${price}</span>
    <span class="s-card__shipping">${ship}</span>
  </li>`

const page = `<html><body>
  <h1 class="srp-controls__count-heading"><span>1,113 results for</span> ultra premium</h1>
  <ul class="srp-results">
    ${card("123456789012", "Pokemon 30th UPC Night Sealed", "$359.99", "Nov 14, 2026", "Free delivery")}
    ${card("223456789012", "Pokemon UPC Night Umbreon", "$385.00", "Nov 13, 2026", "+$10.88 delivery")}
    ${card("323456789012", "Pokemon UPC Night (UK)", "£300.00", "Nov 13, 2026", "+$40.00 delivery")}
    ${card("423456789012", "Pokemon UPC Night best offer", "$549.99", "Nov 12, 2026", "Free delivery", true)}
  </ul></body></html>`

describe("collectSoldPage", () => {
  const { document } = parseHTML(page)

  it("reads sold cards, skips foreign prices, flags best offers and reads eBay's count", () => {
    const r = collectSoldPage(document as unknown as Document)
    expect(r.total).toBe(1113)
    expect(r.challenged).toBe(false)
    expect(r.rows.map((x) => [x.external_id, x.price, x.shipping, x.sold_on, x.best_offer])).toEqual([
      ["123456789012", 359.99, 0, "2026-11-14", false],
      ["223456789012", 385, 10.88, "2026-11-13", false],
      ["423456789012", 549.99, 0, "2026-11-12", true],
    ])
  })

  it("still works as standalone source (the phone app injects it with toString)", () => {
    const fn = new Function(`return (${collectSoldPage.toString()})`)() as typeof collectSoldPage
    expect(fn(document as unknown as Document).rows).toHaveLength(3)
  })

  it("gives the same rows as the extension's collector", () => {
    const src = readFileSync(join(__dirname, "../../extension/comps-ebay.js"), "utf8")
    const g: Record<string, unknown> = {}
    new Function("globalThis", "chrome", src)(g, undefined)
    const ext = (g.FLcollectSoldCards as (d: unknown) => unknown[])(document)
    expect(ext).toEqual(collectSoldPage(document as unknown as Document).rows)
  })

  it("searches US sellers, newest first", () => {
    expect(ebaySoldUrl("Pokemon 30th Night")).toContain("_nkw=Pokemon%2030th%20Night&LH_Sold=1&LH_Complete=1&LH_PrefLoc=1&_sop=13")
  })
})
