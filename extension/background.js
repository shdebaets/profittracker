// Service worker: opens marketplace tabs for jobs sent by the FlipLedger app,
// hands each tab its job, and routes the result back to the app tab.
// Jobs live in chrome.storage.session because the worker can be suspended.
// Also checks public listing pages for sales (CHECK_SALES) and imports a seller's
// Mercari listings (IMPORT: a background tab collects the links, then each page is read).
importScripts("shared.js")

const SITES = {
  facebook: { create: "https://www.facebook.com/marketplace/create/item", manage: "https://www.facebook.com/marketplace/you/selling" },
  poshmark: { create: "https://poshmark.com/create-listing", manage: "https://poshmark.com/closet" },
  mercari: { create: "https://www.mercari.com/sell/", manage: "https://www.mercari.com/mypage/listings/" },
}
const SALE_CHECK_HOSTS = { poshmark: "poshmark.com", mercari: "www.mercari.com" }

const key = (tabId) => `job:${tabId}`

async function saveJob(tabId, job) {
  await chrome.storage.session.set({ [key(tabId)]: job })
}
async function loadJob(tabId) {
  return (await chrome.storage.session.get(key(tabId)))[key(tabId)] ?? null
}
async function dropJob(tabId) {
  await chrome.storage.session.remove(key(tabId))
}

async function toDataUrl(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Photo download failed (${res.status})`)
  const blob = await res.blob()
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ""
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return `data:${blob.type || "image/jpeg"};base64,${btoa(bin)}`
}

function tellApp(job, payload) {
  if (job?.appTabId == null) return
  chrome.tabs.sendMessage(job.appTabId, { to: "app", jobId: job.jobId, marketplace: job.marketplace, ...payload }).catch(() => {
    // The FlipLedger tab was closed; the app falls back to "I listed it".
  })
}

async function startJob(msg, sender) {
  const site = SITES[msg.marketplace]
  if (!site) throw new Error(`${msg.marketplace} isn't supported by this extension yet`)
  const kind = { LIST: "list", DELIST: "delist", IMPORT: "import" }[msg.type]
  if (kind === "import" && msg.marketplace !== "mercari") throw new Error(`Importing from ${msg.marketplace} isn't supported yet`)
  const job = {
    kind,
    jobId: msg.jobId,
    marketplace: msg.marketplace,
    appTabId: sender.tab?.id ?? null,
    listing: msg.listing ?? null,
    listingId: msg.listingId ?? null,
    itemId: msg.itemId ?? msg.listing?.itemId ?? null,
    title: msg.title ?? msg.listing?.title ?? "",
    url: msg.url ?? null,
    auto: msg.type === "DELIST" && msg.auto === true,
    autoPublish: msg.type === "LIST" && msg.autoPublish === true,
    state: "opened",
  }
  if (job.auto && !job.url) throw new Error("Auto-delist needs the listing's link")
  const target = job.kind === "list" ? site.create : job.kind === "import" ? site.manage : job.url || site.manage
  // Import stays in front: Chrome doesn't render background tabs, so their lists never load more on scroll.
  const tab = await chrome.tabs.create({ url: target, active: !job.auto })
  await saveJob(tab.id, job)
}

/**
 * Fetch each listing's public page and read whether it sold. Normally no cookies are
 * sent: sold status is public, and this keeps the check from acting as the seller.
 */
async function checkSales(listings) {
  const results = []
  async function check(l) {
    let url
    try {
      url = new URL(l.url)
    } catch {
      return
    }
    const host = SALE_CHECK_HOSTS[l.marketplace]
    // Links pasted by hand may drop or add "www."; fetch the host we have permission for.
    if (!host || url.protocol !== "https:" || url.hostname.replace(/^www\./, "") !== host.replace(/^www\./, "")) return
    url.hostname = host
    try {
      const res = await fetchPublicPage(url.href)
      if (res.status === 404 || res.status === 410) results.push({ listingId: l.listingId, state: "unavailable", priceCents: null })
      else if (res.ok) results.push({ listingId: l.listingId, ...FL.saleStatus(l.marketplace, url.href, await res.text()) })
    } catch (e) {
      console.warn("FlipLedger: couldn't check", url.href, e)
    }
  }
  await inBatches((listings ?? []).slice(0, 100), check)
  return results
}

async function fetchPublicPage(href) {
  const get = (credentials) => fetch(href, { credentials, redirect: "follow", signal: AbortSignal.timeout(10_000) })
  const res = await get("omit")
  // Mercari's Cloudflare check: retry with the clearance the seller got by browsing Mercari.
  return res.headers.get("cf-mitigated") === "challenge" ? get("include") : res
}

/** A few at a time: quick enough for the app's wait, gentle on the sites. */
async function inBatches(list, fn) {
  const queue = [...list]
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) await fn(queue.shift())
  }))
}

/** Read each of the seller's Mercari listing pages; keep the ones still for sale. */
async function readMercariListings(urls) {
  const items = []
  await inBatches(urls.slice(0, 600), async (u) => {
    try {
      const res = await fetchPublicPage(u)
      const item = res.ok && FL.mercariItem(u, await res.text())
      if (item) items.push(item)
    } catch (e) {
      console.warn("FlipLedger: couldn't read", u, e)
    }
  })
  return items
}

// ---------- Research: eBay sold history ----------
// eBay has no public sold-listings API, so the seller's own Chrome reads eBay's sold
// search pages (same as browsing them) in one background tab, one page at a time.

const SOLD_CHECK = "eBay needs you to sign in or pass a check. Open ebay.com in Chrome, finish it, then try again."
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const soldPath = (keyword, page) => `/sch/i.html?_nkw=${encodeURIComponent(keyword)}&LH_Sold=1&LH_Complete=1&_ipg=240&_pgn=${page}`
let soldBusy = false

async function waitComplete(tabId) {
  for (let i = 0; i < 120; i++) {
    const t = await chrome.tabs.get(tabId)
    if (t.status === "complete") return
    await wait(500)
  }
  throw new Error("The eBay tab didn't finish loading.")
}

// Injected into the eBay tab: fetch one sold page same-origin (with the seller's eBay cookies) and parse it.
async function readSoldPage(path) {
  try {
    if (location.origin !== "https://www.ebay.com") return { blocked: true }
    if (typeof globalThis.FL_collectSoldCards !== "function") return { error: "collector-missing" }
    const res = await fetch(path, { credentials: "include" })
    if (/splashui\/captcha|signin\.ebay\.com/i.test(res.url)) return { blocked: true }
    const doc = new DOMParser().parseFromString(await res.text(), "text/html")
    if (/Security Measure|Sign in or Register|Pardon Our Interruption/i.test(doc.title)) return { blocked: true }
    if (!res.ok) return { error: `eBay returned an error (${res.status}).` }
    if (!doc.querySelector(".srp-results") && !/no exact matches/i.test(doc.body.textContent || "")) return { error: "eBay returned a page that couldn't be read." }
    return globalThis.FL_collectSoldCards(doc)
  } catch (e) {
    return { error: "Page script failed: " + (e?.message || String(e)) }
  }
}

async function readSold(tabId, path) {
  let reason = ""
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["ebay-sold.js"] })
      const [out] = await chrome.scripting.executeScript({ target: { tabId }, func: readSoldPage, args: [path] })
      if (out?.result && out.result.error !== "collector-missing") return out.result
      reason = out?.result?.error || "no result"
    } catch (e) {
      reason = e?.message || String(e)
    }
    await wait(1000)
  }
  // Fallback: load the page in the tab itself and read the loaded document.
  try {
    await chrome.tabs.update(tabId, { url: "https://www.ebay.com" + path })
    await waitComplete(tabId)
    await chrome.scripting.executeScript({ target: { tabId }, files: ["ebay-sold.js"] })
    const [out] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (/splashui\/captcha|signin\.ebay\.com/i.test(location.href) || /Security Measure|Sign in or Register|Pardon Our Interruption/i.test(document.title)) return { blocked: true }
        return globalThis.FL_collectSoldCards ? globalThis.FL_collectSoldCards(document) : { error: "collector-missing" }
      },
    })
    if (out?.result) return out.result
  } catch (e) {
    reason = e?.message || String(e)
  }
  return { error: `Couldn't read eBay's sold results (${reason}).` }
}

/** Every sold page for each keyword (up to 20 pages; 2 for a refresh, stopping at known listings). */
async function pullSold(msg, sender) {
  const job = { jobId: msg.jobId, appTabId: sender.tab?.id }
  const say = (payload) => tellApp(job, payload)
  const keywords = (msg.keywords ?? []).filter((k) => typeof k === "string" && k.length <= 200).slice(0, 12)
  const known = new Set(msg.knownIds ?? [])
  const maxPages = msg.refresh ? 2 : 20
  let tabId = null
  try {
    if (!keywords.length) throw new Error("No keywords to search.")
    const tab = await chrome.tabs.create({ url: "https://www.ebay.com" + soldPath(keywords[0], 1), active: false })
    tabId = tab.id
    await chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {})
    await waitComplete(tabId)
    const rows = new Map()
    for (let k = 0; k < keywords.length; k++) {
      for (let page = 1; page <= maxPages; page++) {
        say({ type: "SOLD_PROGRESS", keyword: k + 1, keywords: keywords.length, page, count: rows.size })
        const found = await readSold(tabId, soldPath(keywords[k], page))
        if (found?.blocked) throw new Error(SOLD_CHECK)
        if (found?.error) throw new Error(found.error)
        for (const row of found.rows) {
          const old = rows.get(row.external_id)
          if (old) {
            if (!old.variants_matched.includes(keywords[k])) old.variants_matched.push(keywords[k])
          }
          else rows.set(row.external_id, { ...row, variants_matched: [keywords[k]] })
        }
        const allKnown = found.rows.length > 0 && found.rows.every((r) => known.has(r.external_id))
        if (found.soldCardCount < 200 || (msg.refresh && allKnown)) break
        await wait(500)
      }
      await wait(500)
    }
    say({ type: "SOLD_RESULTS", rows: [...rows.values()] })
  } catch (e) {
    say({ type: "ERROR", error: String(e?.message ?? e) })
  } finally {
    soldBusy = false
    if (tabId != null) chrome.tabs.remove(tabId).catch(() => {})
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ;(async () => {
    // From the FlipLedger app tab.
    if (msg?.from === "app" && msg.type === "CHECK_SALES") {
      return { ok: true, results: await checkSales(msg.listings) }
    }
    if (msg?.from === "app" && msg.type === "PULL_SOLD") {
      if (soldBusy) return { ok: false, error: "A sold-history pull is already running in this Chrome." }
      soldBusy = true
      void pullSold(msg, sender)
      return { ok: true }
    }
    if (msg?.from === "app") {
      await startJob(msg, sender)
      return { ok: true }
    }

    // From a marketplace tab.
    const tabId = sender.tab?.id
    if (tabId == null) return { ok: false }
    const job = await loadJob(tabId)

    if (msg?.type === "GET_JOB") {
      if (!job) return { job: null }
      if (job.kind === "list" && msg.withPhotos) {
        const photos = []
        for (const url of job.listing?.photoUrls ?? []) {
          try {
            photos.push(await toDataUrl(url))
          } catch (e) {
            console.warn("FlipLedger: skipped a photo", e)
          }
        }
        return { job, photos }
      }
      return { job }
    }

    if (!job) return { ok: false }

    if (msg?.type === "UPDATE") {
      await saveJob(tabId, { ...job, ...msg.patch })
      return { ok: true }
    }
    if (msg?.type === "DONE" && job.kind === "import") {
      await dropJob(tabId)
      chrome.tabs.remove(tabId).catch(() => {})
      if (job.appTabId != null) chrome.tabs.update(job.appTabId, { active: true }).catch(() => {})
      const urls = (msg.urls ?? []).filter((u) => FL.listingId("mercari", u))
      tellApp(job, { type: "IMPORTED", candidates: urls.length ? await readMercariListings(urls) : [] })
      return { ok: true }
    }
    if (msg?.type === "DONE") {
      if (job.kind === "list") tellApp(job, { type: "LISTED", itemId: job.itemId, url: msg.url ?? null })
      else tellApp(job, { type: "DELISTED", listingId: job.listingId, itemId: job.itemId })
      await dropJob(tabId)
      if (job.auto) chrome.tabs.remove(tabId).catch(() => {})
      return { ok: true }
    }
    if (msg?.type === "CANCEL") {
      tellApp(job, { type: "ERROR", error: msg.reason || "Cancelled" })
      await dropJob(tabId)
      if (job.auto || job.kind === "import") chrome.tabs.remove(tabId).catch(() => {})
      return { ok: true }
    }
    return { ok: false }
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }))
  return true // async response
})

chrome.tabs.onRemoved.addListener((tabId) => {
  dropJob(tabId)
})
