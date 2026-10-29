// Page helpers for the marketplace content scripts: find fields by what the
// seller sees (label, placeholder), fill React-controlled inputs, and show the
// FlipLedger panel. Hangs off globalThis.FLDOM.
;(function () {
  const FL = globalThis.FL

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  const FIELD = "input:not([type=file]):not([type=hidden]):not([type=radio]):not([type=checkbox]),textarea,select,[role=combobox],[contenteditable=true]"
  const text = (el) => FL.norm(el.innerText || el.textContent)

  /**
   * The input/textarea/select/combobox for a field the seller sees as one of `labels`
   * ("Title", "What are you selling?"). Checks aria-label, <label> text,
   * placeholder and data-testid, in that order.
   */
  function findField(labels) {
    const wants = [labels].flat().map(FL.norm).filter(Boolean)
    const fields = [...document.querySelectorAll(FIELD)].filter(visible)
    for (const want of wants) {
      const direct = fields.find((el) => FL.norm(el.getAttribute("aria-label")) === want)
      if (direct) return direct
      for (const lab of document.querySelectorAll("label")) {
        const t = text(lab)
        if (!(t === want || t.startsWith(want + " "))) continue
        const el =
          lab.querySelector(FIELD) ||
          (lab.htmlFor && document.getElementById(lab.htmlFor)) ||
          (lab.getAttribute("role") === "combobox" ? lab : null)
        if (el && visible(el)) return el
      }
      const byHint = fields.find((el) => {
        const ph = FL.norm(el.getAttribute("placeholder"))
        return (ph && (ph === want || ph.startsWith(want + " "))) || FL.norm(el.getAttribute("data-testid")) === want
      })
      if (byHint) return byHint
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
      const proto =
        el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
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
    const input = await waitFor(() => document.querySelector('input[type="file"][accept*="image"],input[type="file"]'), 20000)
    if (!input) return false
    const dt = new DataTransfer()
    const files = input.multiple === false ? dataUrls.slice(0, 1) : dataUrls
    for (const [i, u] of files.entries()) dt.items.add(await dataUrlToFile(u, i))
    input.files = dt.files
    input.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }

  const OPTION = '[role="option"],[role="menuitemradio"],[role="menuitem"],[role="listbox"] li,ul[class*="dropdown"] li'

  /** Pick the first of `options` that exists in the dropdown labelled `labels`. Returns the text picked, or null. */
  async function chooseOption(labels, options) {
    const wants = [options].flat().filter(Boolean)
    if (!wants.length) return null
    const box = findField(labels)
    if (!box) return null
    if (box instanceof HTMLSelectElement) {
      for (const want of wants) {
        const opt = [...box.options].find((o) => FL.norm(o.text).startsWith(FL.norm(want)))
        if (opt && setValue(box, opt.value)) return want
      }
      return null
    }
    const menuOpen = () => [...document.querySelectorAll(OPTION)].some(visible)
    box.click()
    // Some menus open from their wrapping label (Facebook) rather than the box itself.
    const lab = box.closest("label")
    if (lab && lab !== box && !(await waitFor(menuOpen, 600))) lab.click()
    for (const want of wants) {
      const opt = await waitFor(() => [...document.querySelectorAll(OPTION)].find((o) => visible(o) && text(o).startsWith(FL.norm(want))), 2500)
      if (opt) {
        opt.click()
        return want
      }
    }
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    return null
  }

  /** Click the first of `options` shown as a radio or toggle button (e.g. Mercari's condition). */
  function chooseRadio(options) {
    const candidates = [...document.querySelectorAll('[role="radio"],input[type="radio"],label,button')].filter(visible)
    for (const option of [options].flat().filter(Boolean)) {
      const want = FL.norm(option)
      const hit = candidates.find((el) => {
        const t = el.matches("input") ? FL.norm(el.value || el.labels?.[0]?.textContent) : text(el)
        return t === want || t.startsWith(want + " ")
      })
      if (hit) {
        hit.click()
        return option
      }
    }
    return null
  }

  /** A visible button or link whose text or aria-label matches `re`. */
  function findButton(re) {
    return [...document.querySelectorAll('[role="button"],button,a,[aria-label]')].find(
      (el) => visible(el) && re.test((el.getAttribute("aria-label") || el.innerText || "").trim()),
    )
  }

  // ---------- floating FlipLedger panel (shadow DOM, so the site's CSS can't touch it) ----------

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

  globalThis.FLDOM = { sleep, waitFor, visible, findField, setValue, setPhotos, chooseOption, chooseRadio, findButton, panel, closePanel }
})()
