// Reads the sold listings off an eBay sold-search page. The phone app runs this inside its eBay
// window (via Function.prototype.toString), so it must stay self-contained: no imports, no outer
// variables. Same rules as extension/comps-ebay.js (ported from CompAmp's collector); keep them in step.

export type CollectedSold = {
  external_id: string
  title: string
  price: number
  shipping: number | null
  sold_on: string
  best_offer: boolean
  condition: string | null
}

export function collectSoldPage(doc: Document): { rows: CollectedSold[]; total: number | null; challenged: boolean } {
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
  const FOREIGN = /\bto\b|AU\s*\$|C\s*\$|CAD|AUD|£|€/i
  const rows: CollectedSold[] = []
  const seen = new Set<string>()
  const modern = doc.querySelectorAll("ul.srp-results > li.s-card")
  const cards = modern.length ? modern : doc.querySelectorAll(".s-card, .s-item")
  for (const card of Array.from(cards)) {
    const leaves = Array.from(card.querySelectorAll("*"))
      .filter((e) => e.children.length === 0)
      .map((e) => e.textContent?.trim() ?? "")
    const dm = leaves
      .map((s) => s.match(/^Sold\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})$/i)?.[1])
      .find(Boolean)
      ?.match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})$/)
    const mo = dm ? MONTHS.indexOf((dm[1] ?? "").toLowerCase()) : -1
    const soldOn = dm && mo >= 0 ? `${dm[3]}-${String(mo + 1).padStart(2, "0")}-${String(dm[2]).padStart(2, "0")}` : null
    const id = (card.querySelector('a[href*="/itm/"]') as HTMLAnchorElement | null)?.href.match(/\/itm\/(?:[^/?]+\/)?(\d{9,15})/)?.[1]
    const title = (card.querySelector(".s-card__title, .s-item__title, .s-card__link .su-styled-text.primary")?.textContent ?? "")
      .replace(/^New Listing\s*/i, "")
      .replace(/\s*Opens in a new window or tab\s*$/i, "")
      .trim()
    const priceEl = card.querySelector(".s-card__price, .s-item__price")
    const priceText = priceEl?.textContent ?? ""
    const amount = priceText.match(/(?:US\s*)?\$\s*([\d,]+\.\d{2})/)
    if (!id || !title || !soldOn || !amount || FOREIGN.test(priceText)) continue
    const shipText =
      card.querySelector(".s-item__shipping, .s-item__logisticsCost, .s-card__shipping, .s-card__logistics, .s-card__logisticsCost")?.textContent ??
      leaves.find((s) => /delivery|shipping/i.test(s)) ??
      ""
    const ship = shipText.match(/\$\s*([\d,]+(?:\.\d{2})?)/)
    const shippingKnown = !FOREIGN.test(shipText) && (/free(?:\s+(?:standard|international))?\s+(?:shipping|delivery)/i.test(shipText) || !!ship)
    const price = Number(amount[1]?.replace(/,/g, ""))
    if (price <= 0 || seen.has(id)) continue
    seen.add(id)
    rows.push({
      external_id: id,
      title: title.slice(0, 200),
      price,
      shipping: shippingKnown ? (ship ? Number(ship[1]?.replace(/,/g, "")) : 0) : null,
      sold_on: soldOn,
      best_offer: !!(priceEl?.matches(".strikethrough") || priceEl?.querySelector(".strikethrough")),
      condition: card.querySelector(".s-card__subtitle, .s-item__subtitle")?.textContent?.trim()?.slice(0, 80) ?? null,
    })
  }
  // "1,113 results": eBay's own count of matching sold listings (about 90 days).
  const heading = doc.querySelector(".srp-controls__count-heading")?.textContent ?? ""
  const total = Number(heading.match(/([\d,]+)\s+results?/i)?.[1]?.replace(/,/g, "")) || null
  const challenged = !rows.length && /captcha|verify yourself|security measure|sign in/i.test(doc.body?.innerText?.slice(0, 3000) ?? "")
  return { rows, total, challenged }
}

/** eBay's sold search for a phrase: US sellers, newest first, 240 a page. */
export const ebaySoldUrl = (phrase: string) =>
  `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(phrase.slice(0, 120))}&LH_Sold=1&LH_Complete=1&LH_PrefLoc=1&_sop=13&_ipg=240&rt=nc`
