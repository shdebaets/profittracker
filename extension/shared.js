// Helpers shared by the extension's scripts (and unit-tested from the app repo).
// Classic script: content scripts can't be ES modules, so this hangs off globalThis.FL.
// The background worker loads it too (importScripts), so nothing here may touch the DOM.
;(function () {
  const FL = {
    VERSION: "0.2.0",
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
     * Read a public listing page's HTML and say whether the item is still for sale,
     * from the schema.org Product data the sites publish for search engines.
     * Only the page's first Product counts: a "similar items" list on the page must
     * never be mistaken for this listing selling.
     *   sold:        a buyer bought it
     *   unavailable: taken down or not for sale (not a sale)
     *   available:   still live
     *   unknown:     couldn't tell (blocked, layout changed); do nothing
     */
    saleStatus(html) {
      for (const [, body] of String(html ?? "").matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        let data
        try {
          data = JSON.parse(body.trim())
        } catch {
          continue
        }
        const nodes = [data].flat().flatMap((n) => [n, ...(n?.["@graph"] ?? [])])
        const product = nodes.find((n) => n && /product/i.test(String(n["@type"] ?? "")) && n.offers)
        if (!product) continue
        const offer = [product.offers].flat()[0] ?? {}
        const avail = String(offer.availability ?? "").split("/").pop().toLowerCase()
        const p = Number(offer.price ?? offer.lowPrice)
        const priceCents = Number.isFinite(p) && p > 0 ? Math.round(p * 100) : null
        if (avail === "soldout") return { state: "sold", priceCents }
        if (["instock", "limitedavailability", "onlineonly", "instoreonly", "preorder"].includes(avail)) return { state: "available", priceCents }
        if (avail === "outofstock" || avail === "discontinued") return { state: "unavailable", priceCents }
        return { state: "unknown", priceCents }
      }
      return { state: "unknown", priceCents: null }
    },
  }
  globalThis.FL = FL
})()
