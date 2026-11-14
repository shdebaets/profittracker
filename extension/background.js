// Service worker: opens marketplace tabs for jobs sent by the FlipLedger app,
// hands each tab its job, and routes the result back to the app tab.
// Jobs live in chrome.storage.session because the worker can be suspended.
// Also checks public listing pages for sales (CHECK_SALES) and imports a seller's
// Mercari listings (IMPORT: a background tab collects the links, then each page is read).
// IMPORT_SALES does the same on the seller's Mercari sold lists, to record sales of
// items FlipLedger didn't know about. It only reads pages; it never clicks anything.
importScripts("shared.js")

const SITES = {
  facebook: { create: "https://www.facebook.com/marketplace/create/item", manage: "https://www.facebook.com/marketplace/you/selling" },
  poshmark: { create: "https://poshmark.com/create-listing", manage: "https://poshmark.com/closet" },
  mercari: {
    create: "https://www.mercari.com/sell/",
    manage: "https://www.mercari.com/mypage/listings/",
    // The seller's sold items: waiting to ship/rate, then completed. Paths not yet checked on the real site.
    sold: ["https://www.mercari.com/mypage/listings/in_progress/", "https://www.mercari.com/mypage/listings/complete/"],
  },
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
  const kind = { LIST: "list", DELIST: "delist", IMPORT: "import", IMPORT_SALES: "sales" }[msg.type]
  if ((kind === "import" || kind === "sales") && msg.marketplace !== "mercari") throw new Error(`Importing from ${msg.marketplace} isn't supported yet`)
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
    // IMPORT_SALES: sold-list pages still to read, and the item links found so far.
    pages: kind === "sales" ? site.sold.slice(1) : [],
    urls: [],
  }
  if (job.auto && !job.url) throw new Error("Auto-delist needs the listing's link")
  const target = job.kind === "list" ? site.create : job.kind === "import" ? site.manage : job.kind === "sales" ? site.sold[0] : job.url || site.manage
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

/** Read each sold Mercari item's page; keep the ones that really sold. */
async function readMercariSales(urls) {
  const sales = []
  await inBatches(urls.slice(0, 600), async (u) => {
    try {
      const res = await fetchPublicPage(u)
      const sale = res.ok && FL.mercariSoldItem(u, await res.text())
      if (sale) sales.push(sale)
    } catch (e) {
      console.warn("FlipLedger: couldn't read", u, e)
    }
  })
  return sales
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

/** COMPS: open eBay's public sold search for a query in a background tab; comps-ebay.js reads it. */
async function startComps(msg, sender) {
  const q = String(msg.query ?? "").slice(0, 120)
  if (q.length < 2) throw new Error("Nothing to search for")
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1&_ipg=240&rt=nc`
  const tab = await chrome.tabs.create({ url, active: false })
  await saveJob(tab.id, { kind: "comps", jobId: msg.jobId, marketplace: "ebay", appTabId: sender.tab?.id ?? null, query: q })
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ;(async () => {
    // From the FlipLedger app tab.
    if (msg?.from === "app" && msg.type === "COMPS") {
      await startComps(msg, sender)
      return { ok: true }
    }
    if (msg?.from === "app" && msg.type === "CHECK_SALES") {
      return { ok: true, results: await checkSales(msg.listings) }
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
    if (msg?.type === "DONE" && job.kind === "comps") {
      await dropJob(tabId)
      chrome.tabs.remove(tabId).catch(() => {})
      if (msg.challenged) tellApp(job, { type: "ERROR", error: "eBay asked for a security check. Open ebay.com in Chrome, finish it, then try again." })
      else tellApp(job, { type: "SOLD_COMPS", query: job.query, rows: Array.isArray(msg.rows) ? msg.rows : [] })
      return { ok: true }
    }
    if (msg?.type === "DONE" && job.kind === "sales") {
      const ids = new Set([...job.urls, ...(msg.urls ?? [])].map((u) => FL.mercariId(u)).filter(Boolean))
      const urls = [...ids].map((id) => `https://www.mercari.com/us/item/${id}/`)
      if (job.pages.length) {
        // Next sold list in the same tab; the runner collects again when it loads.
        const [next, ...rest] = job.pages
        await saveJob(tabId, { ...job, pages: rest, urls })
        await chrome.tabs.update(tabId, { url: next })
        return { ok: true }
      }
      await dropJob(tabId)
      chrome.tabs.remove(tabId).catch(() => {})
      if (job.appTabId != null) chrome.tabs.update(job.appTabId, { active: true }).catch(() => {})
      tellApp(job, { type: "SOLD_ITEMS", sales: urls.length ? await readMercariSales(urls) : [] })
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
      if (job.auto || job.kind === "import" || job.kind === "sales") chrome.tabs.remove(tabId).catch(() => {})
      return { ok: true }
    }
    return { ok: false }
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }))
  return true // async response
})

chrome.tabs.onRemoved.addListener((tabId) => {
  dropJob(tabId)
})
