// Injected into a background www.ebay.com tab (chrome.scripting) to read sold results.
// Self-contained: no imports, never throws out of a call.
;(function () {
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

  /** Sold cards on an eBay search results document (USD only, one row per listing). */
  function collectSoldCards(doc) {
    const rows = []
    const seen = new Set()
    let skipped = 0
    let soldCardCount = 0
    const modern = doc.querySelectorAll("ul.srp-results > li.s-card")
    const cards = modern.length ? modern : doc.querySelectorAll(".s-card, .s-item")
    for (const card of cards) {
      const leaves = Array.from(card.querySelectorAll("*"))
        .filter((e) => e.children.length === 0)
        .map((e) => (e.textContent || "").trim())
      const date = leaves.map((s) => s.match(/^Sold\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})$/i)?.[1]).find(Boolean)
      // eBay's calendar date as shown ("Sold Nov 8, 2026" -> 2026-11-08).
      const dm = date && date.match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})$/)
      const mo = dm ? MONTHS.indexOf(dm[1].toLowerCase()) : -1
      const soldOn = dm && mo >= 0 ? `${dm[3]}-${String(mo + 1).padStart(2, "0")}-${String(dm[2]).padStart(2, "0")}` : null
      // Count dated sold cards before filtering, so pagination isn't cut short.
      if (soldOn) soldCardCount++
      const link = card.querySelector('a[href*="/itm/"]')
      const id = link && link.href.match(/\/itm\/(?:[^/?]+\/)?(\d{9,15})/)?.[1]
      const title = ((card.querySelector(".s-card__title, .s-item__title, .s-card__link .su-styled-text.primary") || {}).textContent || "")
        .replace(/^New Listing\s*/i, "")
        .replace(/\s*Opens in a new window or tab\s*$/i, "")
        .trim()
      const priceEl = card.querySelector(".s-card__price, .s-item__price")
      const priceText = (priceEl && priceEl.textContent) || ""
      const amount = priceText.match(/(?:US\s*)?\$\s*([\d,]+\.\d{2})/)
      if (!id || !title || !soldOn || !amount || /\bto\b|AU\s*\$|C\s*\$|CAD|AUD|£|€/i.test(priceText)) {
        skipped++
        continue
      }
      const shipEl = card.querySelector(".s-item__shipping, .s-item__logisticsCost, .s-card__shipping, .s-card__logistics, .s-card__logisticsCost")
      const shipText = (shipEl && shipEl.textContent) || leaves.find((s) => /delivery|shipping/i.test(s)) || ""
      const ship = shipText.match(/\$\s*([\d,]+(?:\.\d{2})?)/)
      const shippingKnown =
        !/AU\s*\$|C\s*\$|CAD|AUD|£|€|\bto\b/i.test(shipText) && (/free(?:\s+(?:standard|international))?\s+(?:shipping|delivery)/i.test(shipText) || !!ship)
      const price = Number(amount[1].replace(/,/g, ""))
      if (price <= 0 || seen.has(id)) continue
      seen.add(id)
      rows.push({
        external_id: id,
        title,
        sold_on: soldOn,
        price,
        shipping: shippingKnown ? (ship ? Number(ship[1].replace(/,/g, "")) : 0) : null,
        // eBay shows the list price struck through when a best offer was accepted.
        best_offer: !!(priceEl && (priceEl.matches(".strikethrough") || priceEl.querySelector(".strikethrough"))),
        format: leaves.filter((s) => /Buy It Now|Best Offer|\d+ bids?/i.test(s)).join(" · ") || null,
        condition: ((card.querySelector(".s-card__subtitle, .s-item__subtitle") || {}).textContent || "").trim() || null,
        seller: ((card.querySelector(".s-card__seller, .s-item__seller-info-text") || {}).textContent || "").trim() || null,
        variants_matched: [],
      })
    }
    return { rows, skipped, soldCardCount }
  }

  globalThis.FL_collectSoldCards = collectSoldCards
})()
