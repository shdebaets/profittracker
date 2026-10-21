// Runs on facebook.com/marketplace/*. For a FlipLedger job in this tab it:
//  - list:   fills the "Create new listing" form (photos, title, price, condition,
//            description), then stops so the seller picks a category and publishes;
//            reports the listing back to FlipLedger once it's published.
//  - delist: points the seller at "Mark as sold" and reports back once it's done.
// Fields are found by their visible labels, not Facebook's generated class names.
;(function () {
  const FL = globalThis.FL
  if (window.__flipledgerFb) return
  window.__flipledgerFb = true

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const send = (msg) => chrome.runtime.sendMessage(msg)

  async function waitFor(fn, timeout = 15000, every = 250) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const v = fn()
      if (v) return v
      await sleep(every)
    }
    return null
  }

  const visible = (el) => !!el && el.getClientRects().length > 0

  /** The input/textarea/combobox for a visible label such as "Title" or "Price". */
  function findField(label) {
    const want = FL.norm(label)
    const direct = [...document.querySelectorAll(`[aria-label]`)].find(
      (el) => FL.norm(el.getAttribute("aria-label")) === want && visible(el) && el.matches("input,textarea,[role=combobox],[contenteditable=true]"),
    )
    if (direct) return direct
    for (const lab of document.querySelectorAll("label")) {
      const text = FL.norm(lab.innerText || lab.textContent)
      if (!(text === want || text.startsWith(want + " "))) continue
      const el =
        lab.querySelector("input:not([type=file]),textarea,[role=combobox],[contenteditable=true]") ||
        (lab.htmlFor && document.getElementById(lab.htmlFor)) ||
        (lab.getAttribute("role") === "combobox" ? lab : null)
      if (el && visible(el)) return el
    }
    return null
  }

  /** Set a React-controlled field so React sees the change. */
  function setValue(el, value) {
    el.focus()
    if (el.isContentEditable) {
      document.execCommand("selectAll", false)
      document.execCommand("insertText", false, value)
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value)
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
    }
    el.blur()
    return FL.norm(el.value ?? el.textContent).length > 0 || value === ""
  }

  async function dataUrlToFile(dataUrl, i) {
    const blob = await (await fetch(dataUrl)).blob()
    return new File([blob], `photo-${i + 1}.jpg`, { type: blob.type || "image/jpeg" })
  }

  async function setPhotos(dataUrls) {
    if (!dataUrls.length) return false
    const input = await waitFor(() => document.querySelector('input[type="file"][accept*="image"]'), 20000)
    if (!input) return false
    const dt = new DataTransfer()
    for (const [i, u] of dataUrls.entries()) dt.items.add(await dataUrlToFile(u, i))
    input.files = dt.files
    input.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }

  async function chooseOption(label, optionText) {
    const box = findField(label)
    if (!box) return false
    ;(box.closest("label") || box).click()
    const want = FL.norm(optionText)
    const opt = await waitFor(
      () =>
        [...document.querySelectorAll('[role="option"],[role="menuitemradio"],[role="menuitem"]')].find(
          (o) => visible(o) && FL.norm(o.innerText || o.textContent).startsWith(want),
        ),
      4000,
    )
    if (!opt) {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      return false
    }
    opt.click()
    return true
  }

  // ---------- floating FlipLedger panel (shadow DOM, so Facebook's CSS can't touch it) ----------

  let panelRoot = null
  function panel({ title, lines = [], buttons = [] }) {
    if (!panelRoot) {
      const host = document.createElement("div")
      host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647"
      panelRoot = host.attachShadow({ mode: "open" })
      document.documentElement.appendChild(host)
    }
    panelRoot.innerHTML = `
      <style>
        .box{font:14px/1.4 -apple-system,system-ui,sans-serif;background:#1c1917;color:#fafaf9;border-radius:16px;
          padding:14px 16px;width:300px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
        .t{font-weight:700;margin-bottom:6px;color:#f59e0b} ul{margin:0;padding-left:18px} li{margin:2px 0}
        .row{display:flex;gap:8px;margin-top:10px}
        button{flex:1;border:0;border-radius:10px;padding:8px 10px;font-weight:700;cursor:pointer}
        .p{background:#16a34a;color:#fff} .s{background:#44403c;color:#fafaf9}
      </style>
      <div class="box"><div class="t"></div><ul></ul><div class="row"></div></div>`
    panelRoot.querySelector(".t").textContent = `FlipLedger · ${title}`
    const ul = panelRoot.querySelector("ul")
    for (const l of lines) {
      const li = document.createElement("li")
      li.textContent = l
      ul.appendChild(li)
    }
    const row = panelRoot.querySelector(".row")
    for (const b of buttons) {
      const el = document.createElement("button")
      el.textContent = b.label
      el.className = b.primary ? "p" : "s"
      el.onclick = b.onClick
      row.appendChild(el)
    }
  }
  function closePanel() {
    panelRoot?.host.remove()
    panelRoot = null
  }

  // ---------- list ----------

  let busy = false
  async function fillListing(job, photos) {
    if (busy) return
    busy = true
    try {
      const l = job.listing
      panel({ title: "Filling your listing…", lines: ["Hang on a few seconds."] })
      await waitFor(() => findField("Title"), 20000)

      const done = []
      const todo = []
      const step = (ok, label) => (ok ? done : todo).push(label)
      if (await setPhotos(photos)) done.push(`${photos.length} photo${photos.length === 1 ? "" : "s"}`)
      else todo.push("Add photos")
      const title = findField("Title")
      step(!!title && setValue(title, l.title.slice(0, 99)), "Title")
      const price = findField("Price")
      step(!!price && setValue(price, FL.facebookPrice(l.priceCents)), "Price")
      const cond = FL.facebookCondition(l.condition)
      step(!!cond && (await chooseOption("Condition", cond)), cond ? `Condition (${cond})` : "Condition")
      const desc = findField("Description")
      step(!!desc && setValue(desc, FL.listingText(l)), "Description")

      await send({ type: "UPDATE", patch: { state: "filled" } })
      panel({
        title: "Ready for you",
        lines: [
          `Filled: ${done.join(", ") || "nothing"}.`,
          `Your turn: pick a Category${todo.length ? `, ${todo.join(", ")}` : ""}.`,
          "Check everything, then click Next and Publish. FlipLedger records it automatically.",
        ],
        buttons: [
          { label: "I published it", primary: true, onClick: () => finishListing(job) },
          { label: "Cancel", onClick: () => cancel("You cancelled the Facebook listing") },
        ],
      })
    } catch (e) {
      panel({
        title: "Couldn't fill everything",
        lines: [String(e?.message ?? e), "You can still finish the listing by hand."],
        buttons: [{ label: "I published it", primary: true, onClick: () => finishListing(job) }, { label: "Cancel", onClick: () => cancel(String(e)) }],
      })
    } finally {
      busy = false
    }
  }

  async function finishListing(job) {
    panel({ title: "Recording it…", lines: ["Looking for your new listing."] })
    let url = null
    if (/\/marketplace\/item\/\d+/.test(location.pathname)) url = location.href.split("?")[0]
    else url = await waitFor(() => FL.findListingHref(document.querySelectorAll('a[href*="/marketplace/item/"]'), job.title), 6000)
    await send({ type: "DONE", url })
    panel({ title: "Done", lines: ["Saved in FlipLedger. You can close this tab."], buttons: [{ label: "Close", onClick: closePanel }] })
  }

  async function cancel(reason) {
    await send({ type: "CANCEL", reason })
    closePanel()
  }

  // ---------- delist ----------

  function markSoldButton() {
    return [...document.querySelectorAll('[role="button"],button,[aria-label]')].find(
      (el) => visible(el) && /^mark as sold$/i.test((el.getAttribute("aria-label") || el.innerText || "").trim()),
    )
  }
  const looksSold = () =>
    [...document.querySelectorAll('[role="button"],button,[aria-label]')].some((el) =>
      /^mark as (available|in stock)$/i.test((el.getAttribute("aria-label") || el.innerText || "").trim()),
    ) || /this listing is no longer available|listing deleted/i.test(document.body.innerText)

  let delistWatch = null
  async function guideDelist(job) {
    const btn = await waitFor(markSoldButton, 8000)
    if (btn) {
      btn.style.outline = "3px solid #f59e0b"
      btn.style.outlineOffset = "2px"
      btn.scrollIntoView({ block: "center" })
    }
    panel({
      title: "Sold elsewhere",
      lines: [
        `"${job.title}" sold on another marketplace.`,
        btn ? 'Click "Mark as sold" (highlighted), or delete the listing.' : "Open the listing, then mark it as sold or delete it.",
      ],
      buttons: [
        { label: "Done", primary: true, onClick: () => finishDelist() },
        { label: "Cancel", onClick: () => cancel("Delisting cancelled") },
      ],
    })
    clearInterval(delistWatch)
    delistWatch = setInterval(() => {
      if (looksSold()) finishDelist()
    }, 1500)
  }
  async function finishDelist() {
    clearInterval(delistWatch)
    await send({ type: "DONE" })
    panel({ title: "Done", lines: ["Marked as ended in FlipLedger."], buttons: [{ label: "Close", onClick: closePanel }] })
  }

  // ---------- routing (Facebook is a single-page app, so watch the URL) ----------

  let lastPath = ""
  async function route() {
    if (location.pathname === lastPath) return
    lastPath = location.pathname
    const onCreate = location.pathname.startsWith("/marketplace/create")
    const { job, photos } = (await send({ type: "GET_JOB", withPhotos: onCreate })) ?? {}
    if (!job) return
    if (job.kind === "list") {
      if (onCreate) return fillListing(job, photos ?? [])
      // Facebook lands on your listings (or the new item) after Publish.
      const published = /^\/marketplace\/(you\/selling|item\/\d+)/.test(location.pathname)
      if (job.state === "filled" && published) return finishListing(job)
    } else {
      return guideDelist(job)
    }
  }

  route()
  setInterval(route, 1000)
})()
