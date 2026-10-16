// FlipLedger service worker: caches the app shell and static assets so the
// app opens offline. Data always comes from the network.
const VERSION = "v1"
const STATIC = `static-${VERSION}`
const PAGES = `pages-${VERSION}`
const OFFLINE_URL = "/offline.html"

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC).then((c) =>
      c.addAll([OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"]),
    ),
  )
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![STATIC, PAGES].includes(k)).map((k) => caches.delete(k))),
    ),
  )
  self.clients.claim()
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Immutable build assets: cache first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone()
            caches.open(STATIC).then((c) => c.put(req, copy))
            return res
          }),
      ),
    )
    return
  }

  // Page navigations: network first, fall back to last cached copy, then offline page.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone()
            caches.open(PAGES).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(async () => (await caches.match(req)) || (await caches.match(OFFLINE_URL))),
    )
  }
})
