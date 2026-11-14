// Runs on eBay sold-search pages opened by FlipLedger (a "comps" job). Reads the sold
// listings on the page (ported from CompAmp's collector) and hands them back. Only reads.
;(function () {
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
  const FOREIGN = /\bto\b|AU\s*\$|C\s*\$|CAD|AUD|£|€/i

  function collectSoldCards(doc) {
    const rows = []
    const seen = new Set()
    const modern = doc.querySelectorAll("ul.srp-results > li.s-card")
    const cards = modern.length ? modern : doc.querySelectorAll(".s-card, .s-item")
    for (const card of cards) {
      const leaves = Array.from(card.querySelectorAll("*")).filter((e) => e.children.length === 0).map((e) => e.textContent?.trim() ?? "")
      const dm = leaves
        .map((s) => s.match(/^Sold\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})$/i)?.[1])
        .find(Boolean)
        ?.match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})$/)
      const mo = dm ? MONTHS.indexOf((dm[1] ?? "").toLowerCase()) : -1
      const soldOn = dm && mo >= 0 ? `${dm[3]}-${String(mo + 1).padStart(2, "0")}-${String(dm[2]).padStart(2, "0")}` : null
      const id = card.querySelector('a[href*="/itm/"]')?.href.match(/\/itm\/(?:[^/?]+\/)?(\d{9,15})/)?.[1]
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
    return rows
  }
  globalThis.FLcollectSoldCards = collectSoldCards

  async function run() {
    const res = await chrome.runtime.sendMessage({ type: "GET_JOB" }).catch(() => null)
    const job = res?.job
    if (!job || job.kind !== "comps") return
    // Give eBay's results a moment to render.
    await new Promise((r) => setTimeout(r, 1500))
    const rows = collectSoldCards(document)
    const challenged = !rows.length && /captcha|verify yourself|security measure|sign in/i.test(document.body?.innerText?.slice(0, 3000) ?? "")
    chrome.runtime.sendMessage({ type: "DONE", rows, challenged }).catch(() => {})
  }
  if (typeof chrome !== "undefined" && chrome.runtime?.id) run()
})()
