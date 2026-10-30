import { beforeAll, describe, expect, it } from "vitest"
import { saleStatus, type SaleStatus } from "../lib/marketplaces/sale-status"

type Parser = (marketplace: string, url: string, html: string) => SaleStatus
let extensionParser: Parser

beforeAll(async () => {
  // extension/shared.js is a classic script that hangs its helpers off globalThis.FL.
  await import("./shared.js")
  extensionParser = (globalThis as unknown as { FL: { saleStatus: Parser } }).FL.saleStatus
})

// Built to match the structure of real pages (checked 2026-10-30).
const POSH_ID = "6ae39b435ac6f2cd42f32233"
const POSH_URL = `https://poshmark.com/listing/Nike-Track-Jacket-${POSH_ID}`
const ld = (price: string, availability: string) =>
  `<script type="application/ld+json">{"@type":"Product","offers":{"price":"${price}","availability":"https:\\u002F\\u002Fschema.org\\u002F${availability}"}}</script>`
const poshListing = (id: string, status: string) =>
  `{"id":"${id}","price_amount":{"val":"150.0"},"status":"published","inventory":{"status":"${status}","multi_item":false}}`
const poshPage = (status: string, availability = "InStock") =>
  `<html>${ld("45.00", availability)}<script>${poshListing(POSH_ID, status)}` +
  `,{"similar":[${poshListing("6ae4b12f2f16e6b8b851b713", "available")},${poshListing("6ae4b12c30724a9e098ddbee", "sold_out")}]}</script></html>`

const MERC_URL = "https://www.mercari.com/us/item/m12215929581/"
const mercPage = (status: string) =>
  `<html>${ld("50", "InStock")}<script>{"ItemDetailLatestTimeLimitedSale:1":{"status":"completed"},` +
  `"item":{"id":"m12215929581","buyer":null,"status":"${status}","isWebVisible":true,"name":"Jacket"}}</script></html>`

describe.each([
  ["app", () => saleStatus as Parser],
  ["extension", () => extensionParser],
])("saleStatus (%s)", (_name, parser) => {
  it("reads Poshmark's own inventory status", () => {
    expect(parser()("poshmark", POSH_URL, poshPage("sold_out", "OutOfStock"))).toEqual({ state: "sold", priceCents: 4500 })
    expect(parser()("poshmark", POSH_URL, poshPage("available"))).toEqual({ state: "available", priceCents: 4500 })
    expect(parser()("poshmark", POSH_URL, poshPage("not_for_sale", "OutOfStock")).state).toBe("unavailable")
  })

  it("isn't fooled by a similar item that sold, or by another listing's page", () => {
    expect(parser()("poshmark", POSH_URL, poshPage("available")).state).toBe("available")
    const other = `https://poshmark.com/listing/Other-${"a".repeat(24)}`
    expect(parser()("poshmark", other, poshPage("sold_out")).state).toBe("unknown")
  })

  it("reads Mercari's item status, not schema.org's InStock", () => {
    expect(parser()("mercari", MERC_URL, mercPage("trading"))).toEqual({ state: "sold", priceCents: 5000 })
    expect(parser()("mercari", MERC_URL, mercPage("on_sale"))).toEqual({ state: "available", priceCents: 5000 })
    expect(parser()("mercari", MERC_URL, mercPage("inactive")).state).toBe("unavailable")
  })

  it("says unknown for blocked pages, new statuses and other sites", () => {
    const cloudflare = "<html><title>Just a moment...</title></html>"
    expect(parser()("mercari", MERC_URL, cloudflare)).toEqual({ state: "unknown", priceCents: null })
    expect(parser()("poshmark", POSH_URL, "")).toEqual({ state: "unknown", priceCents: null })
    expect(parser()("mercari", MERC_URL, mercPage("something_new")).state).toBe("unknown")
    expect(parser()("depop", POSH_URL, poshPage("sold_out")).state).toBe("unknown")
  })
})
