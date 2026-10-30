// Read a public Poshmark or Mercari listing page and say whether it has sold.
// schema.org availability can't be trusted here: a sold Poshmark listing says OutOfStock
// (same as "not for sale") and a sold Mercari item still says InStock. So read each site's
// own status field, and only the one belonging to this listing: the pages also carry
// "similar items", which have statuses of their own.
// extension/shared.js holds the same rules in plain JS; extension/sale-status.test.ts runs both on the same pages.

export type SaleState = "sold" | "available" | "unavailable" | "unknown"
export type SaleStatus = { state: SaleState; priceCents: number | null }

const RULES = {
  poshmark: {
    urlId: /-([0-9a-f]{24})(?:[/?#]|$)/,
    id: /"id":"([0-9a-f]{24})"/g,
    status: /"inventory":\{"status":"(\w+)"/g,
    sold: ["sold_out"],
    available: ["available"],
    unavailable: ["not_for_sale", "removed", "deleted"],
  },
  mercari: {
    urlId: /\/item\/(m\d+)/,
    id: /"id":"(m\d+)"/g,
    status: /"status":"(\w+)","isWebVisible"/g,
    sold: ["trading", "sold_out", "completed"],
    available: ["on_sale"],
    unavailable: ["inactive", "stop", "cancel", "deleted"],
  },
}

/** The first schema.org Product offer price on the page, in cents. */
function offerPrice(html: string): number | null {
  for (const [, body] of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(body.trim())
      const nodes = [data].flat().flatMap((n) => [n, ...(n?.["@graph"] ?? [])])
      const product = nodes.find((n) => n && /product/i.test(String(n["@type"] ?? "")) && n.offers)
      if (!product) continue
      const p = Number([product.offers].flat()[0]?.price)
      return Number.isFinite(p) && p > 0 ? Math.round(p * 100) : null
    } catch {
      // Not valid JSON; try the next block.
    }
  }
  return null
}

export function saleStatus(marketplace: string, url: string, html: string): SaleStatus {
  const rules = RULES[marketplace as keyof typeof RULES]
  const ownId = rules && url.match(rules.urlId)?.[1]
  if (!ownId) return { state: "unknown", priceCents: null }
  for (const m of html.matchAll(rules.status)) {
    const before = html.slice(Math.max(0, m.index - 20_000), m.index)
    if ([...before.matchAll(rules.id)].at(-1)?.[1] !== ownId) continue
    const state: SaleState = rules.sold.includes(m[1])
      ? "sold"
      : rules.available.includes(m[1])
        ? "available"
        : rules.unavailable.includes(m[1])
          ? "unavailable"
          : "unknown"
    return { state, priceCents: offerPrice(html) }
  }
  return { state: "unknown", priceCents: null }
}
