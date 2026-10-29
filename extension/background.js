// Service worker: opens marketplace tabs for jobs sent by the FlipLedger app,
// hands each tab its job, and routes the result back to the app tab.
// Jobs live in chrome.storage.session because the worker can be suspended.

const FB_CREATE_URL = "https://www.facebook.com/marketplace/create/item"
const FB_SELLING_URL = "https://www.facebook.com/marketplace/you/selling"

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
  if (msg.marketplace !== "facebook") throw new Error(`${msg.marketplace} isn't supported by this extension yet`)
  const job = {
    kind: msg.type === "LIST" ? "list" : "delist",
    jobId: msg.jobId,
    marketplace: msg.marketplace,
    appTabId: sender.tab?.id ?? null,
    listing: msg.listing ?? null,
    listingId: msg.listingId ?? null,
    itemId: msg.itemId ?? msg.listing?.itemId ?? null,
    title: msg.title ?? msg.listing?.title ?? "",
    url: msg.url ?? null,
    state: "opened",
  }
  const target = job.kind === "list" ? FB_CREATE_URL : job.url || FB_SELLING_URL
  const tab = await chrome.tabs.create({ url: target, active: true })
  await saveJob(tab.id, job)
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ;(async () => {
    // From the FlipLedger app tab.
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
    if (msg?.type === "DONE") {
      if (job.kind === "list") tellApp(job, { type: "LISTED", itemId: job.itemId, url: msg.url ?? null })
      else tellApp(job, { type: "DELISTED", listingId: job.listingId, itemId: job.itemId })
      await dropJob(tabId)
      return { ok: true }
    }
    if (msg?.type === "CANCEL") {
      tellApp(job, { type: "ERROR", error: msg.reason || "Cancelled" })
      await dropJob(tabId)
      return { ok: true }
    }
    return { ok: false }
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }))
  return true // async response
})

chrome.tabs.onRemoved.addListener((tabId) => {
  dropJob(tabId)
})
