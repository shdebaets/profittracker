// Helpers shared by the extension's scripts (and unit-tested from the app repo).
// Classic script: content scripts can't be ES modules, so this hangs off globalThis.FL.
;(function () {
  const FL = {
    VERSION: "0.1.0",
    /** Marketplaces this extension can drive. */
    MARKETPLACES: ["facebook"],
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

    /** Loose text match: case/space/punctuation-insensitive. */
    norm(s) {
      return String(s ?? "")
        .toLowerCase()
        .replace(/[‐-―]/g, "-")
        .replace(/[^a-z0-9-]+/g, " ")
        .trim()
    },

    /**
     * Find the URL of a just-published listing on a page of the seller's
     * listings: the first /marketplace/item/<id> link whose text contains
     * the title (Facebook may truncate long titles, so match a prefix).
     */
    findListingHref(links, title) {
      const want = FL.norm(title).slice(0, 40)
      if (!want) return null
      for (const a of links) {
        const href = a.href || a.getAttribute?.("href") || ""
        if (!/\/marketplace\/item\/\d+/.test(href)) continue
        const text = FL.norm(a.textContent || a.getAttribute?.("aria-label") || "")
        if (text.includes(want) || (text.length >= 12 && want.startsWith(text.slice(0, 40)))) {
          const m = href.match(/^(.*\/marketplace\/item\/\d+)/)
          return m ? (m[1].startsWith("http") ? m[1] : "https://www.facebook.com" + m[1]) : href
        }
      }
      return null
    },

    /** Price in whole dollars as Facebook's field expects ("45", "12.5" → "13"). */
    facebookPrice(cents) {
      if (!cents && cents !== 0) return ""
      return String(Math.round(cents / 100))
    },

    /** Description text: description + condition/brand/size facts. */
    listingText({ description, condition, brand, size }) {
      const cond = { new_with_tags: "New with tags", new: "New, no tags", like_new: "Like new", good: "Good", fair: "Fair" }[condition]
      const facts = [cond && `Condition: ${cond}`, brand && `Brand: ${brand}`, size && `Size: ${size}`].filter(Boolean)
      return [String(description ?? "").trim(), facts.join("\n")].filter(Boolean).join("\n\n")
    },
  }
  globalThis.FL = FL
})()
