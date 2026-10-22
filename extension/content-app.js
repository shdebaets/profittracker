// Runs on the FlipLedger web app. Bridges window.postMessage (the page) and the
// extension's background worker. Only messages from this same page are accepted.
;(function () {
  const { APP_SOURCE, EXT_SOURCE, VERSION, MARKETPLACES } = globalThis.FL

  const announce = () => {
    document.documentElement.setAttribute("data-flipledger-ext", VERSION)
    window.postMessage({ source: EXT_SOURCE, type: "READY", version: VERSION, marketplaces: MARKETPLACES }, location.origin)
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return
    const msg = event.data
    if (!msg || msg.source !== APP_SOURCE) return
    if (msg.type === "PING") return announce()
    if (msg.type !== "LIST" && msg.type !== "DELIST") return
    const fail = (error) =>
      window.postMessage({ source: EXT_SOURCE, type: "ERROR", jobId: msg.jobId, marketplace: msg.marketplace, error }, location.origin)
    chrome.runtime
      .sendMessage({ from: "app", ...msg })
      .then((res) => res?.ok || fail(res?.error || "The extension couldn't start this job"))
      .catch((e) => fail(String(e?.message ?? e)))
  })

  // Results coming back from a marketplace tab (LISTED / DELISTED / ERROR).
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.to !== "app") return
    const rest = { ...msg }
    delete rest.to
    window.postMessage({ source: EXT_SOURCE, ...rest }, location.origin)
  })

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", announce)
  else announce()
})()
