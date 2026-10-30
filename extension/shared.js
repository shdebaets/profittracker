// Helpers shared by the extension's scripts (and unit-tested from the app repo).
// Classic script: content scripts can't be ES modules, so this hangs off globalThis.FL.
// The background worker loads it too (importScripts), so nothing here may touch the DOM.
;(function () {
  const FL = {
    VERSION: "0.3.0",
    /** Marketplaces this extension can drive. */
    MARKETPLACES: ["facebook", "poshmark", "mercari"],
    APP_SOURCE: "flipledger-app",
    EXT_SOURCE: "flipledger-ext",

    /** FlipLedger condition → the option text on Facebook's Condition menu. */
    facebookCondition(condition) {
      switch (condition) {
        case "new_with_tags":
        case "new":
          return "New"
        case "like_new":
          return "Used - Like New"
        case "good":
          return "Used - Good"
        case "fair":
          return "Used - Fair"
        default:
          return null
      }
    },

    /**
     * FlipLedger condition → option texts to try on Poshmark or Mercari, best first.
     * Their wording changes now and then, so each has fallbacks.
     */
    conditionChoices(marketplace, condition) {
      const table = {
        poshmark: {
          new_with_tags: ["New With Tags", "NWT"],
          new: ["New Without Tags", "NWOT", "Like New"],
          like_new: ["Like New"],
          good: ["Good"],
          fair: ["Fair"],
        },
        mercari: {
          new_with_tags: ["New"],
          new: ["New", "Like new"],
          like_new: ["Like new"],
          good: ["Good"],
          fair: ["Fair"],
        },
      }
      return table[marketplace]?.[condition] ?? []
    },

    /** The listing's ID in a marketplace link, or null. Auto-delist only acts on pages carrying this ID. */
    listingId(marketplace, url) {
      const pattern = { facebook: /\/marketplace\/item\/(\d+)/, poshmark: /-([0-9a-f]{24})(?:[/?#]|$)/, mercari: /\/item\/(m\d+)/ }[marketplace]
      return String(url ?? "").match(pattern ?? /$^/)?.[1] ?? null
    },

    /** Loose text match: case/space/punctuation-insensitive. */
    norm(s) {
      return String(s ?? "")
        .toLowerCase()
        .replace(/[‐-―]/g, "-")
        .replace(/[^a-z0-9-]+/g, " ")
        .trim()
    },

    /**
     * Find the URL of a just-published listing among page links: the first link
     * matching `pattern` whose text contains the title (sites truncate long titles,
     * so match a prefix). The URL is cut at the end of the pattern match.
     */
    findListingHref(links, title, pattern = /\/marketplace\/item\/\d+/, origin = "https://www.facebook.com") {
      const want = FL.norm(title).slice(0, 40)
      if (!want) return null
      for (const a of links) {
        const href = a.href || a.getAttribute?.("href") || ""
        const m = href.match(pattern)
        if (!m) continue
        const text = FL.norm(a.textContent || a.getAttribute?.("aria-label") || "")
        if (text.includes(want) || (text.length >= 12 && want.startsWith(text.slice(0, 40)))) {
          const upTo = href.slice(0, m.index + m[0].length)
          return upTo.startsWith("http") ? upTo : origin + upTo
        }
      }
      return null
    },

    /** Price in whole dollars, as Facebook, Poshmark and Mercari expect ("45", "12.5" → "13"). */
    wholeDollars(cents) {
      if (!cents && cents !== 0) return ""
      return String(Math.round(cents / 100))
    },
    facebookPrice(cents) {
      return FL.wholeDollars(cents)
    },

    /** Description text: description + condition/brand/size facts. */
    listingText({ description, condition, brand, size }) {
      const cond = { new_with_tags: "New with tags", new: "New, no tags", like_new: "Like new", good: "Good", fair: "Fair" }[condition]
      const facts = [cond && `Condition: ${cond}`, brand && `Brand: ${brand}`, size && `Size: ${size}`].filter(Boolean)
      return [String(description ?? "").trim(), facts.join("\n")].filter(Boolean).join("\n\n")
    },

    /**
     * Read a public listing page's HTML and say whether it has sold. Same rules as the
     * app's lib/marketplaces/sale-status.ts (see why there); a test runs both on the same pages.
     *   sold:        a buyer bought it
     *   unavailable: taken down or not for sale (not a sale)
     *   available:   still live
     *   unknown:     couldn't tell (blocked, layout changed); do nothing
     */
    saleStatus(marketplace, url, html) {
      const rules = {
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
      }[marketplace]
      const page = String(html ?? "")
      const ownId = rules && String(url).match(rules.urlId)?.[1]
      if (!ownId) return { state: "unknown", priceCents: null }
      for (const m of page.matchAll(rules.status)) {
        const before = page.slice(Math.max(0, m.index - 20000), m.index)
        if ([...before.matchAll(rules.id)].at(-1)?.[1] !== ownId) continue
        const state = rules.sold.includes(m[1])
          ? "sold"
          : rules.available.includes(m[1])
            ? "available"
            : rules.unavailable.includes(m[1])
              ? "unavailable"
              : "unknown"
        return { state, priceCents: FL.offerPrice(page) }
      }
      return { state: "unknown", priceCents: null }
    },

    /** The first schema.org Product offer price on the page, in cents. */
    offerPrice(page) {
      for (const [, body] of page.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
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
    },
  }
  globalThis.FL = FL
})()
