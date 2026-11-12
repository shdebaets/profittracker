// Helpers shared by the extension's scripts (and unit-tested from the app repo).
// Classic script: content scripts can't be ES modules, so this hangs off globalThis.FL.
// The background worker loads it too (importScripts), so nothing here may touch the DOM.
;(function () {
  // ---------- category guessing ----------
  // Checked in order, so garments come before the brands that also make shoes
  // ("Jordan hoodie" is a hoodie) and "dress" skips "dress shoes".
  const KINDS = [
    ["trading_cards", /\b(pok[eé]mon cards?|tcg|booster (box|pack)|elite trainer|etb|psa \d+|bgs \d+|topps|panini|trading cards?|yu-?gi-?oh|mtg|magic the gathering)\b/],
    ["video_games", /\bvideo ?games?\b|\b(ps[2-5]|playstation|xbox|nintendo|switch|wii|3ds)\b.*\bgames?\b|\bgames?\b.*\b(ps[2-5]|playstation|xbox|nintendo|switch)\b/],
    ["consoles", /\b(consoles?|ps[2-5]|playstation [2-5]|xbox (one|series [xs]|360)|nintendo switch|switch oled|steam deck|game ?boy|controllers?)\b/],
    ["phones", /\b(iphone|galaxy s\d+|pixel \d+|smartphone|cell ?phone)\b/],
    ["computers", /\b(laptop|macbook|chromebook|ipad|tablet|imac|desktop pc|gaming pc)\b/],
    ["headphones", /\b(headphones?|airpods|earbuds|beats (studio|solo|fit|flex))\b/],
    ["cameras", /\b(camera|dslr|mirrorless|gopro|camera lens)\b/],
    ["swim", /\b(swimsuit|swimwear|bikini|swim trunks|board ?shorts|one[- ]piece swim)\b/],
    ["dresses", /\bdress\b(?! (shoes?|shirt|pants|socks|boots?|slacks))|\b(gown|romper|jumpsuit)\b/],
    ["skirts", /\bskirts?\b/],
    ["hoodies", /\b(hoodie|hoody|sweatshirt|crewneck|quarter[- ]zip|1\/4 zip|half[- ]zip|pullover)\b/],
    ["sweaters", /\b(sweater|cardigan)\b/],
    ["jackets", /\b(jacket|coat|parka|puffer|windbreaker|anorak|blazer|vest|fleece)\b/],
    ["jeans", /\bjeans\b/],
    ["shorts", /\bshorts\b/],
    ["pants", /\b(pants|joggers|trousers|leggings|sweatpants|chinos|cargos)\b/],
    ["tops", /\b(t-?shirt|tee|shirt|blouse|tank( top)?|polo|top|jersey|camisole|button[- ](up|down)|henley)\b/],
    ["heels", /\b(heels|pumps|stilettos)\b/],
    ["boots", /\b(boots?|uggs?|timberlands?)\b/],
    ["sandals", /\b(sandals?|slides|flip[- ]flops?|crocs|birkenstocks?)\b/],
    ["sneakers", /\b(sneakers?|trainers|running shoes?|jordan|air max|air force 1|af1|dunks?|yeezy|new balance|asics|vans|converse|ultraboost)\b/],
    ["shoes", /\b(shoes?|loafers|oxfords|flats|clogs|mules)\b/],
    ["wallets", /\b(wallet|card ?holder)\b/],
    ["bags", /\b(handbag|purse|backpack|tote|crossbody|clutch|duffel|duffle|bag)\b/],
    ["hats", /\b(hat|cap|beanie|snapback)\b/],
    ["watches", /\bwatch\b/],
    ["sunglasses", /\bsunglasses\b/],
    ["belts", /\bbelts?\b/],
    ["jewelry", /\b(necklace|bracelet|earrings?|ring|pendant|jewelry)\b/],
    ["toys", /\b(lego|funko|action figure|hot wheels|barbie|plush|squishmallows?|toys?|puzzle|board game)\b/],
    ["books", /\b(books?|hardcover|paperback|novel)\b/],
    ["beauty", /\b(perfume|cologne|fragrance|eau de|makeup|lipstick|mascara|skincare)\b/],
    ["home", /\b(lamp|decor|blanket|pillow|candle|vase|cookware|mug|dinnerware|bedding)\b/],
    ["tools", /\b(drill|impact driver|dewalt|milwaukee|makita|ryobi|tool set|tools?)\b/],
  ]
  // Kids first: "boys" and "GS" sneakers are kids' even when a brand says "men".
  const DEPTS = [
    ["kids", /\b(kids?|youth|toddler|infant|baby|boys?'?|girls?'?|children'?s|gs|td|\d{1,2}t)\b/],
    ["women", /\b(women'?s?|womens|ladies|lady|wmns)\b/],
    ["men", /\b(men'?s?|mens|man's)\b/],
  ]
  const ACCESSORIES = new Set(["wallets", "bags", "hats", "watches", "sunglasses", "belts", "jewelry"])
  const FASHION = new Set([
    "swim", "dresses", "skirts", "hoodies", "sweaters", "jackets", "jeans", "shorts", "pants", "tops",
    "heels", "boots", "sandals", "sneakers", "shoes", ...ACCESSORIES,
  ])

  const FACEBOOK = {
    trading_cards: ["Antiques & Collectibles", "Toys & Games"],
    video_games: ["Video Games"],
    consoles: ["Video Games"],
    phones: ["Mobile Phones", "Electronics & Computers"],
    computers: ["Electronics & Computers"],
    headphones: ["Electronics & Computers"],
    cameras: ["Electronics & Computers"],
    toys: ["Toys & Games"],
    books: ["Books, Movies & Music"],
    beauty: ["Health & Beauty"],
    home: ["Household", "Home Goods"],
    tools: ["Tools"],
  }

  // Poshmark: Department › Category › Subcategory (the subcategory is optional there).
  const POSHMARK = {
    depts: { women: ["Women"], men: ["Men"], kids: ["Kids"] },
    women: {
      tops: [["Tops"]], hoodies: [["Tops"], ["Sweatshirts & Hoodies"]], sweaters: [["Sweaters"]],
      jackets: [["Jackets & Coats"]], jeans: [["Jeans"]], pants: [["Pants & Jumpsuits", "Pants"]], shorts: [["Shorts"]],
      skirts: [["Skirts"]], dresses: [["Dresses"]], swim: [["Swim"]],
      sneakers: [["Shoes"], ["Sneakers"]], heels: [["Shoes"], ["Heels"]], sandals: [["Shoes"], ["Sandals"]], boots: [["Shoes"]], shoes: [["Shoes"]],
      bags: [["Bags"]], wallets: [["Bags"], ["Wallets"]], jewelry: [["Jewelry"]],
      hats: [["Accessories"], ["Hats"]], watches: [["Accessories"], ["Watches"]], sunglasses: [["Accessories"], ["Sunglasses"]], belts: [["Accessories"], ["Belts"]],
    },
    men: {
      tops: [["Shirts"]], hoodies: [["Shirts", "Sweaters"], ["Sweatshirts & Hoodies"]], sweaters: [["Sweaters"]],
      jackets: [["Jackets & Coats"]], jeans: [["Jeans"]], pants: [["Pants"]], shorts: [["Shorts"]], swim: [["Swim"]],
      sneakers: [["Shoes"], ["Sneakers"]], boots: [["Shoes"], ["Boots"]], sandals: [["Shoes"], ["Sandals & Flip-Flops", "Sandals"]], shoes: [["Shoes"]],
      bags: [["Bags"]], wallets: [["Accessories"], ["Wallets"]], jewelry: [["Accessories"], ["Jewelry"]],
      hats: [["Accessories"], ["Hats"]], watches: [["Accessories"], ["Watches"]], sunglasses: [["Accessories"], ["Sunglasses"]], belts: [["Accessories"], ["Belts"]],
    },
    kids: {
      tops: [["Shirts & Tops"]], hoodies: [["Shirts & Tops"]], sweaters: [["Shirts & Tops"]], jackets: [["Jackets & Coats"]],
      jeans: [["Bottoms"]], pants: [["Bottoms"]], shorts: [["Bottoms"]], skirts: [["Bottoms"]], dresses: [["Dresses"]], swim: [["Swim"]],
      sneakers: [["Shoes"]], boots: [["Shoes"]], sandals: [["Shoes"]], heels: [["Shoes"]], shoes: [["Shoes"]],
      bags: [["Accessories"]], wallets: [["Accessories"]], jewelry: [["Accessories"]], hats: [["Accessories"]], watches: [["Accessories"]], sunglasses: [["Accessories"]], belts: [["Accessories"]],
    },
    other: {
      video_games: [["Electronics"], ["Video Games & Consoles"]],
      consoles: [["Electronics"], ["Video Games & Consoles"]],
      phones: [["Electronics"], ["Cell Phones & Accessories"]],
      computers: [["Electronics"], ["Computers, Laptops & Parts", "Computers"]],
      headphones: [["Electronics"], ["Headphones"]],
      cameras: [["Electronics"], ["Cameras, Photo & Video", "Cameras"]],
      toys: [["Kids"], ["Toys"]],
      home: [["Home"]],
    },
  }

  // Mercari: Category › Subcategory › Type. Its tree is deeper and changes more, so
  // these stop early where unsure and the seller picks the last level.
  const MERCARI = {
    depts: { women: ["Women"], men: ["Men"], kids: ["Kids"] },
    women: {
      tops: [["Tops & blouses", "Tops"]], hoodies: [["Sweats & hoodies", "Tops & blouses"]], sweaters: [["Sweaters"]],
      jackets: [["Coats & jackets"]], jeans: [["Jeans"]], pants: [["Pants"]], shorts: [["Shorts"]], skirts: [["Skirts"]],
      dresses: [["Dresses"]], swim: [["Swimwear"]],
      sneakers: [["Shoes"], ["Athletic", "Sneakers"]], heels: [["Shoes"], ["Heels", "Pumps"]], sandals: [["Shoes"], ["Sandals"]], boots: [["Shoes"], ["Boots"]], shoes: [["Shoes"]],
      bags: [["Women's handbags", "Handbags", "Bags"]], wallets: [["Women's accessories", "Accessories"], ["Wallets"]], jewelry: [["Jewelry"]],
      hats: [["Women's accessories", "Accessories"], ["Hats"]], watches: [["Women's accessories", "Accessories"], ["Watches"]],
      sunglasses: [["Women's accessories", "Accessories"], ["Sunglasses"]], belts: [["Women's accessories", "Accessories"], ["Belts"]],
    },
    men: {
      tops: [["Tops", "Shirts"]], hoodies: [["Sweats & hoodies", "Sweatshirts & hoodies"]], sweaters: [["Sweaters"]],
      jackets: [["Coats & jackets"]], jeans: [["Jeans"]], pants: [["Pants"]], shorts: [["Shorts"]], swim: [["Swimwear"]],
      sneakers: [["Shoes"], ["Athletic", "Sneakers"]], boots: [["Shoes"], ["Boots"]], sandals: [["Shoes"], ["Sandals"]], shoes: [["Shoes"]],
      bags: [["Bags"]], wallets: [["Men's accessories", "Accessories"], ["Wallets"]], jewelry: [["Jewelry"]],
      hats: [["Men's accessories", "Accessories"], ["Hats"]], watches: [["Men's accessories", "Accessories"], ["Watches"]],
      sunglasses: [["Men's accessories", "Accessories"], ["Sunglasses"]], belts: [["Men's accessories", "Accessories"], ["Belts"]],
    },
    kids: {
      sneakers: [["Shoes"]], boots: [["Shoes"]], sandals: [["Shoes"]], shoes: [["Shoes"]],
    },
    other: {
      video_games: [["Electronics"], ["Video games & consoles"], ["Games"]],
      consoles: [["Electronics"], ["Video games & consoles"]],
      phones: [["Electronics"], ["Cell phones & accessories"]],
      computers: [["Electronics"], ["Computers, laptops & parts", "Computers"]],
      headphones: [["Electronics"], ["TV, audio & surveillance", "Audio"]],
      cameras: [["Electronics"], ["Cameras & photography", "Cameras"]],
      trading_cards: [["Toys & Collectibles", "Toys", "Vintage & collectibles"], ["Trading cards", "Collectible card games"]],
      toys: [["Toys & Collectibles", "Toys"]],
      books: [["Books"]],
      beauty: [["Beauty"]],
      home: [["Home"]],
      tools: [["Tools", "Home"]],
    },
  }

  // Poshmark Assistant limits. The caps are hard ceilings: the seller can set lower ones, never higher.
  const POSH = {
    MAX_SHARES: 300,
    MAX_OFFERS: 50,
    /** Poshmark wants an Offer to Likers at least 10% under the listing price. */
    MIN_DISCOUNT: 10,
    MIN_DELAY_MS: 3000,
    MAX_DELAY_MS: 8000,

    /** A random wait between two actions, 3 to 8 seconds. `rand` is Math.random (swappable for tests). */
    delayMs(rand = Math.random) {
      return Math.round(POSH.MIN_DELAY_MS + rand() * (POSH.MAX_DELAY_MS - POSH.MIN_DELAY_MS))
    },

    /** The seller's local calendar day, "2026-11-12": caps reset at the seller's midnight. */
    dayKey(date = new Date()) {
      const pad = (n) => String(n).padStart(2, "0")
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    },

    /** Today's counts from what's stored. Anything from another day (or garbage) starts at zero. */
    counts(stored, day) {
      if (!stored || stored.day !== day) return { day, shares: 0, offers: 0, offered: [] }
      return {
        day,
        shares: Math.max(0, Number(stored.shares) || 0),
        offers: Math.max(0, Number(stored.offers) || 0),
        offered: Array.isArray(stored.offered) ? stored.offered.filter((id) => typeof id === "string") : [],
      }
    },

    /** The daily cap in force: the seller's own, but never above the hard ceiling (and at least 0). */
    cap(kind, wanted) {
      const max = kind === "offers" ? POSH.MAX_OFFERS : POSH.MAX_SHARES
      const n = Math.floor(Number(wanted))
      return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : max
    },

    /** How many more `kind` ("shares" or "offers") are allowed today. */
    remaining(counts, kind, wanted) {
      return Math.max(0, POSH.cap(kind, wanted) - (counts[kind] ?? 0))
    },

    /** Counts after one more `kind`; an offer also remembers its listing so a rerun skips it today. */
    bump(counts, kind, listingId) {
      const next = { ...counts, [kind]: (counts[kind] ?? 0) + 1 }
      if (kind === "offers" && listingId) next.offered = [...counts.offered, listingId]
      return next
    },

    /**
     * The Offer to Likers price in cents, in whole dollars (Poshmark's prices are), or null to skip:
     * `percent` off the listing price, rounded down, raised to the floor if it lands under it, and
     * skipped when that leaves less than Poshmark's minimum discount (or the inputs make no sense).
     */
    offerCents(priceCents, percent, floorCents) {
      const price = Number(priceCents)
      const pct = Number(percent)
      const floor = Math.max(0, Number(floorCents) || 0)
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(pct) || pct <= 0 || pct >= 100) return null
      const target = Math.floor((price * (100 - pct)) / 100 / 100) * 100
      const offer = Math.max(target, Math.ceil(floor / 100) * 100)
      const ceiling = Math.floor((price * (100 - POSH.MIN_DISCOUNT)) / 100 / 100) * 100
      return offer > 0 && offer <= ceiling ? offer : null
    },

    /**
     * Why the assistant must stop on this page, or null if it may carry on. `text` is what the page
     * is saying (dialogs, alerts, toasts, or the whole page when it's short), `captcha` whether a
     * captcha widget is on it, and `expect` what the page should be: "closet" (the seller's own
     * closet) or "listing". Anything else stops it.
     */
    stopReason({ pathname, text, captcha, username, expect }) {
      const t = String(text ?? "").toLowerCase()
      const path = String(pathname ?? "")
      if (captcha || /captcha|are you a robot|verify (that )?you(?:'re| are) (a )?human|security check/.test(t)) return "Poshmark showed a captcha"
      if (/slow down|too many|try again later|temporarily (blocked|restricted|unavailable)|rate limit|unusual activity/.test(t)) {
        return "Poshmark asked to slow down"
      }
      if (/^\/(login|signup|sign-?in)/i.test(path) || /\blog ?in to (continue|poshmark)\b/.test(t)) return "You're not logged in to Poshmark in this Chrome"
      if (expect === "closet") {
        const own = `/closet/${String(username ?? "").toLowerCase()}`
        if (!username || path.toLowerCase().replace(/\/$/, "") !== own) return "It ended up on a page that isn't your closet"
      } else if (expect === "listing") {
        if (!/^\/listing\/[^/?#]*-[0-9a-f]{24}/.test(path)) return "It ended up on a page that isn't one of your listings"
      }
      return null
    },

    /** A Poshmark username as typed ("@name", a closet link, spaces) → "name", or "" if it isn't one. */
    username(input) {
      const s = String(input ?? "").trim().replace(/^https?:\/\/(www\.)?poshmark\.com\/closet\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "")
      return /^[A-Za-z0-9_.-]{1,40}$/.test(s) ? s : ""
    },
  }

  const FL = {
    VERSION: "0.8.0",
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

    /**
     * What an item probably is, from its title (then its description): { dept, kind }.
     * dept is "women" | "men" | "kids" | null; kind is a key of KINDS, or null when unsure.
     * Used to pick each site's category; the seller checks it before publishing.
     */
    guessCategory({ title, description }) {
      const find = (s) => KINDS.find(([, re]) => re.test(s))?.[0] ?? null
      const t = String(title ?? "").toLowerCase()
      const kind = find(t) ?? find(String(description ?? "").toLowerCase())
      let dept = DEPTS.find(([, re]) => re.test(t))?.[0] ?? null
      if (!dept && ["dresses", "skirts", "heels"].includes(kind)) dept = "women"
      return { dept, kind }
    },

    /**
     * The menu choices that pick `guess`'s category on a marketplace: one array of
     * acceptable option texts per level (best first), or null when there's no good match.
     */
    categoryPath(marketplace, { dept, kind }) {
      if (!kind) return null
      const fashion = FASHION.has(kind)
      if (marketplace === "facebook") {
        if (!fashion) return FACEBOOK[kind] ? [FACEBOOK[kind]] : null
        if (kind === "bags" || kind === "wallets") return [["Bags & Luggage"]]
        if (ACCESSORIES.has(kind)) return [["Jewelry & Accessories"]]
        const d = { women: ["Women's Clothing & Shoes"], men: ["Men's Clothing & Shoes"], kids: ["Baby & Kids", "Kids"] }[dept]
        return d ? [d] : null
      }
      const table = { poshmark: POSHMARK, mercari: MERCARI }[marketplace]
      if (!table) return null
      if (!fashion) return table.other[kind] ?? null
      const top = table.depts[dept]
      const rest = top && table[dept][kind]
      return rest ? [top, ...rest] : null
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

    /** The first schema.org Product (with an offer) on the page, or null. */
    productData(page) {
      for (const [, body] of page.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
          const data = JSON.parse(body.trim())
          const nodes = [data].flat().flatMap((n) => [n, ...(n?.["@graph"] ?? [])])
          const product = nodes.find((n) => n && /product/i.test(String(n["@type"] ?? "")) && n.offers)
          if (product) return product
        } catch {
          // Not valid JSON; try the next block.
        }
      }
      return null
    },

    /** The first schema.org Product offer price on the page, in cents. */
    offerPrice(page) {
      const p = Number([FL.productData(page)?.offers].flat()[0]?.price)
      return Number.isFinite(p) && p > 0 ? Math.round(p * 100) : null
    },

    /**
     * A live Mercari listing read from its public page, in the shape the app imports
     * (lib/import/plan.ts ImportCandidate), or null if it isn't for sale or can't be read.
     */
    mercariItem(url, html) {
      const id = FL.listingId("mercari", url)
      if (!id || FL.saleStatus("mercari", url, html).state !== "available") return null
      const p = FL.productData(String(html ?? ""))
      if (!p?.name) return null
      const image = [p.image].flat()[0]
      const offer = [p.offers].flat()[0] ?? {}
      const condition = String(p.itemCondition ?? offer.itemCondition ?? "")
      return {
        marketplace: "mercari",
        externalId: id,
        url: `https://www.mercari.com/us/item/${id}/`,
        title: String(p.name).trim().slice(0, 200),
        description: String(p.description ?? "").trim().slice(0, 5000),
        priceCents: FL.offerPrice(html),
        brand: String((typeof p.brand === "object" ? p.brand?.name : p.brand) ?? "").trim().slice(0, 100),
        size: "",
        // schema.org only says new or used; the seller can set the exact grade later.
        condition: /NewCondition/i.test(condition) ? "new" : null,
        photoUrl: typeof image === "string" ? image : (image?.url ?? image?.contentUrl ?? null),
      }
    },

    /** Mercari item ID in any link to it: the item page, or a sold item's transaction page. */
    mercariId(url) {
      return String(url ?? "").match(/\/(?:us\/)?(?:item|transaction)s?\/(m\d+)/)?.[1] ?? null
    },

    /**
     * A sold Mercari listing read from its public page, in the shape the app records as an
     * untracked sale (lib/sales/untracked.ts MarketplaceSale), or null if it isn't sold.
     * The sold date is read from the item's own data when the page has one (best guess at
     * the field name until checked on the real site); otherwise the app uses today.
     */
    mercariSoldItem(url, html) {
      const id = FL.listingId("mercari", url)
      const page = String(html ?? "")
      if (!id || FL.saleStatus("mercari", url, page).state !== "sold") return null
      const p = FL.productData(page)
      if (!p?.name) return null
      const image = [p.image].flat()[0]
      const own = page.indexOf(`"id":"${id}"`)
      const near = own < 0 ? "" : page.slice(own, own + 20000)
      const stamp = near.match(/"(?:updated|soldAt|soldDate|updatedAt)":"?(\d{10}|\d{4}-\d\d-\d\dT[^"]+)/)?.[1]
      const when = !stamp ? null : /^\d{10}$/.test(stamp) ? new Date(Number(stamp) * 1000) : new Date(stamp)
      return {
        marketplace: "mercari",
        externalId: id,
        url: `https://www.mercari.com/us/item/${id}/`,
        title: String(p.name).trim().slice(0, 200),
        priceCents: FL.offerPrice(page),
        soldAt: when && !isNaN(when.getTime()) ? when.toISOString() : null,
        photoUrl: typeof image === "string" ? image : (image?.url ?? image?.contentUrl ?? null),
      }
    },

    // ---------- Poshmark Assistant (posh-assistant.js): the pure parts, unit-tested ----------
    posh: POSH,
  }
  globalThis.FL = FL
})()
