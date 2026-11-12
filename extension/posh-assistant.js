// Poshmark Assistant: runs on poshmark.com for the three opt-in jobs the seller starts from
// FlipLedger (Settings → Poshmark Assistant → Run now), in the tab the extension opened:
//  - share_closet: shares every available listing in the seller's own closet to their followers.
//  - share_party:  shares only the listings Poshmark offers to the live party (its share menu only
//                  shows the party for listings that match it).
//  - offer_likers: sends Offer to Likers on the seller's listings, at the seller's percentage off,
//                  never under their floor price.
// Safety rules (all required, see CLAUDE.md):
//  - a random 3–8 second wait between actions (FL.posh.delayMs);
//  - daily caps (300 shares, 50 offers at most; the seller can set lower) counted in chrome.storage;
//  - it stops at once on a captcha, a "slow down"/"too many" message, a login page, or any page
//    it didn't expect, and reports why;
//  - it only runs while this tab is open (no alarms, nothing in the background worker).
// It never follows, follows back or relists. The pure parts (offer math, caps, stop rules) are in
// shared.js (FL.posh) and unit-tested. The selectors are best guesses until run on the real site.
;(function () {
  const FL = globalThis.FL
  const D = globalThis.FLDOM
  const P = FL?.posh
  if (!P || !D || location.hostname !== "poshmark.com" || window.__flipledgerPosh) return
  window.__flipledgerPosh = true

  const KINDS = ["share_closet", "share_party", "offer_likers"]
  const TITLES = { share_closet: "Sharing your closet", share_party: "Sharing to the party", offer_likers: "Offering to likers" }
  const COUNTS = "posh:counts"
  const LISTING = /\/listing\/[^/?#]*-([0-9a-f]{24})/
  const SHARE = '[data-et-name="share"],[class*="share-gray"],[class*="social-action-bar__share"],[aria-label="Share" i]'
  const DIALOG = '[role="dialog"],[role="alertdialog"],.modal,[class*="modal"]'

  const send = (msg) => chrome.runtime.sendMessage(msg)

  /** A safety stop: reported to FlipLedger as an error, and the tab stays open so the seller sees why. */
  class Stop extends Error {}
  let stopped = false // the seller clicked Stop

  // ---------- caps (chrome.storage.local, per computer, reset at the seller's midnight) ----------

  async function loadCounts() {
    return P.counts((await chrome.storage.local.get(COUNTS))[COUNTS], P.dayKey())
  }
  async function count(kind, listingId) {
    const next = P.bump(await loadCounts(), kind, listingId)
    await chrome.storage.local.set({ [COUNTS]: next })
    return next
  }

  // ---------- reading the page ----------

  const dialogs = () => [...document.querySelectorAll(DIALOG)].filter(D.visible)
  const label = (el) => (el.getAttribute("aria-label") || el.innerText || "").trim()

  /** What the page is saying: dialogs, alerts and toasts, or all of it when the page is short (block pages are). */
  function pageText() {
    const bits = [...document.querySelectorAll(`${DIALOG},[role="alert"],[class*="toast"],[class*="flash"],[class*="snackbar"]`)]
      .filter(D.visible)
      .map((el) => el.innerText)
    const body = document.body?.innerText ?? ""
    return [document.title, ...bits, body.length < 3000 ? body : ""].join("\n").slice(0, 8000)
  }
  const captchaShown = () =>
    !!document.querySelector('iframe[src*="captcha"],iframe[src*="challenges.cloudflare.com"],[id*="captcha" i],[class*="captcha" i]')

  /** Throws a Stop if this page isn't one the job should be on, or Poshmark is pushing back. */
  function check(job, expect) {
    const reason = P.stopReason({ pathname: location.pathname, text: pageText(), captcha: captchaShown(), username: job.username, expect })
    if (reason) throw new Stop(reason)
  }

  /** The innermost visible element in an open dialog whose text matches `re` (and not `not`). */
  function inDialog(re, not) {
    let best = null
    for (const d of dialogs()) {
      for (const el of d.querySelectorAll('button,a,[role="button"],[role="menuitem"],li,div,span,p')) {
        if (!D.visible(el)) continue
        const t = label(el)
        if (re.test(t) && !not?.test(t) && (!best || best.contains(el))) best = el
      }
    }
    return best
  }

  async function closeDialog() {
    const x = dialogs()
      .flatMap((d) => [...d.querySelectorAll('button,[role="button"],[aria-label]')])
      .find((b) => D.visible(b) && /^(close|cancel|×|✕|x)$/i.test(label(b)))
    if (x) x.click()
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    return D.waitFor(() => !dialogs().length, 4000)
  }

  /** Listing tiles in the closet: { id, url, share }. A tile is the nearest wrapper of one listing link that holds a share button. */
  function tiles() {
    const found = new Map()
    for (const a of document.querySelectorAll('a[href*="/listing/"]')) {
      const m = a.href.match(LISTING)
      if (!m || found.has(m[1])) continue
      for (let el = a.parentElement, depth = 0; el && depth < 8; el = el.parentElement, depth++) {
        const ids = new Set([...el.querySelectorAll('a[href*="/listing/"]')].map((x) => x.href.match(LISTING)?.[1]).filter(Boolean))
        if (ids.size > 1) break // reached the grid: this listing has no share button of its own
        const share = el.querySelector(SHARE) || [...el.querySelectorAll('button,[role="button"],a,span,div')].find((b) => D.visible(b) && /^share$/i.test(label(b)))
        if (!share) continue
        // Sold or not-for-sale tiles carry a tag with just that word.
        const gone = [...el.querySelectorAll("span,div,p")].some((t) => /^(sold|not for sale|reserved)$/i.test((t.innerText || "").trim()))
        if (!gone) found.set(m[1], { id: m[1], url: a.href.slice(0, a.href.indexOf(m[1]) + 24), share })
        break
      }
    }
    return [...found.values()]
  }

  /** All the listing links in the closet, scrolling until no more load (or `enough` are there). */
  async function loadCloset(job, find, enough) {
    await D.waitFor(() => find().length, 15000)
    let last = -1
    for (let round = 0; round < 60 && find().length !== last && find().length < enough; round++) {
      if (stopped) break
      last = find().length
      window.scrollTo(0, document.body.scrollHeight)
      window.dispatchEvent(new Event("scroll"))
      await D.sleep(1800)
      check(job, "closet")
    }
    window.scrollTo(0, 0)
    return find()
  }

  /** The random 3–8 second wait between actions; wakes early if the seller clicks Stop. */
  async function pause() {
    const end = Date.now() + P.delayMs()
    while (Date.now() < end && !stopped) await D.sleep(250)
  }

  // ---------- reporting ----------

  function show(job, lines) {
    D.panel({
      title: `Poshmark Assistant · ${TITLES[job.kind]}`,
      lines: [...lines, "Keep this tab open. It waits a few seconds between actions."],
      buttons: [{ label: "Stop", primary: true, onClick: () => (stopped = true) }],
    })
  }
  const summaryOf = (job) => ({ shared: job.shared ?? 0, offered: job.offered ?? 0, skipped: job.skipped ?? 0 })

  async function progress(job, text) {
    show(job, [text])
    await send({ type: "UPDATE", patch: summaryOf(job) })
    await send({ type: "PROGRESS", text, summary: summaryOf(job) })
  }

  async function finish(job, note) {
    const s = summaryOf(job)
    D.panel({
      title: `Poshmark Assistant · ${TITLES[job.kind]}`,
      lines: [note, ...(job.then?.length ? ["Starting the next job…"] : ["Done. You can close this tab."])],
      buttons: job.then?.length ? [] : [{ label: "Close", onClick: D.closePanel }],
    })
    await send({ type: "DONE", summary: { ...s, note } })
  }

  async function halt(job, reason) {
    D.panel({
      title: "Poshmark Assistant stopped",
      lines: [reason, "Nothing more will happen in this tab. Check Poshmark, then run it again later from FlipLedger."],
      buttons: [{ label: "Close", onClick: D.closePanel }],
    })
    await send({ type: "CANCEL", reason: `Poshmark Assistant stopped: ${reason}.`, summary: summaryOf(job) })
  }

  // ---------- sharing ----------

  const PARTY = /^[^\n]*\bparty\b[^\n]*$/i
  const FOLLOWERS = /^(share )?to my followers$/i

  async function share(job) {
    const party = job.kind === "share_party"
    check(job, "closet")
    // The seller's own closet shows Edit Profile; someone else's (or a logged-out view) doesn't.
    if (!(await D.waitFor(() => D.findButton(/^edit (profile|closet)$/i), 10000))) {
      throw new Stop("this isn't your closet, or you're not logged in to Poshmark in this Chrome")
    }
    let counts = await loadCounts()
    const cap = P.cap("shares", job.caps?.shares)
    if (!P.remaining(counts, "shares", job.caps?.shares)) return finish(job, `Today's limit of ${cap} shares is used up. It resets at midnight.`)

    show(job, ["Loading your listings…"])
    // Parties skip listings that don't match, so load the whole closet for them.
    const all = await loadCloset(job, tiles, party ? Infinity : P.remaining(counts, "shares", job.caps?.shares))
    if (!all.length) return finish(job, "No available listings found in your closet.")
    // Bottom to top, so the closet keeps its order (the last one shared shows first).
    const ids = (party ? all : all.slice(0, P.remaining(counts, "shares", job.caps?.shares))).map((t) => t.id).reverse()
    const done = new Set(job.doneIds ?? [])
    let misses = 0

    for (const id of ids) {
      if (stopped) return finish(job, `Stopped. Shared ${job.shared ?? 0}.`)
      if (done.has(id)) continue
      if (!P.remaining(counts, "shares", job.caps?.shares)) return finish(job, `Shared ${job.shared ?? 0}, which reaches today's limit of ${cap}.`)
      check(job, "closet")
      const t = tiles().find((x) => x.id === id)
      if (!t) continue // re-rendered away (or sold since loading)

      t.share.scrollIntoView({ block: "center" })
      await D.sleep(300)
      t.share.click()
      const menu = await D.waitFor(() => inDialog(FOLLOWERS), 6000)
      check(job, "closet")
      if (!menu) throw new Stop("the share menu didn't open the way FlipLedger expected")

      const target = party ? inDialog(PARTY, /followers/i) : menu
      if (!target) {
        // Poshmark only offers the party for listings that match it.
        await closeDialog()
        job.skipped = (job.skipped ?? 0) + 1
        misses++
        if (!job.shared && misses >= 10) return finish(job, "No party showed up in the share menu for your first 10 listings, so there's probably no party on right now (or none of these match it).")
        await pause()
        continue
      }
      target.click()
      if (!(await D.waitFor(() => !dialogs().length, 8000))) {
        check(job, "closet")
        throw new Stop("Poshmark didn't finish the share")
      }
      counts = await count("shares")
      job.shared = (job.shared ?? 0) + 1
      done.add(id)
      await send({ type: "UPDATE", patch: { doneIds: [...done] } })
      await progress(job, `Shared ${job.shared}${party ? " to the party" : ""} of ${ids.length} (${counts.shares} today).`)
      check(job, "closet")
      await pause()
    }
    return finish(job, party ? `Shared ${job.shared ?? 0} to the party; ${job.skipped ?? 0} didn't match it.` : `Shared ${job.shared ?? 0} listings.`)
  }

  // ---------- Offer to Likers ----------
  // First the closet, to list the seller's available listings; then each listing page in turn
  // (the job keeps the queue, so it carries on after each page load).

  async function offersFromCloset(job) {
    check(job, "closet")
    if (!(await D.waitFor(() => D.findButton(/^edit (profile|closet)$/i), 10000))) {
      throw new Stop("this isn't your closet, or you're not logged in to Poshmark in this Chrome")
    }
    const counts = await loadCounts()
    if (!P.remaining(counts, "offers", job.caps?.offers)) return finish(job, `Today's limit of ${P.cap("offers", job.caps?.offers)} offers is used up. It resets at midnight.`)
    show(job, ["Loading your listings…"])
    const links = () => {
      const urls = new Map()
      for (const a of document.querySelectorAll('a[href*="/listing/"]')) {
        const m = a.href.match(LISTING)
        if (m && !urls.has(m[1])) urls.set(m[1], a.href.slice(0, a.href.indexOf(m[1]) + 24))
      }
      return [...urls.entries()]
    }
    const queue = (await loadCloset(job, links, Infinity)).filter(([id]) => !counts.offered.includes(id)).map(([, url]) => url)
    if (stopped) return finish(job, "Stopped.")
    if (!queue.length) return finish(job, "No listings left to offer on today.")
    await send({ type: "UPDATE", patch: { queue, index: 0 } })
    await pause()
    location.href = queue[0]
  }

  async function nextListing(job, note) {
    const index = (job.index ?? 0) + 1
    job.index = index
    await progress(job, note)
    await send({ type: "UPDATE", patch: { index } })
    if (stopped) return finish(job, `Stopped. Sent ${job.offered ?? 0} offers.`)
    if (index >= job.queue.length) return finish(job, `Sent ${job.offered ?? 0} offers; skipped ${job.skipped ?? 0}.`)
    await pause()
    if (stopped) return finish(job, `Stopped. Sent ${job.offered ?? 0} offers.`)
    location.href = job.queue[index]
  }

  async function offerOnListing(job) {
    const url = job.queue[job.index ?? 0]
    const id = url?.match(LISTING)?.[1]
    check(job, "listing")
    if (!id || !location.pathname.includes(id)) throw new Stop("it opened a different listing than the one it meant to")
    if (!(await D.waitFor(() => D.findButton(/^edit listing$/i), 10000))) throw new Stop("this listing isn't yours, or you're not logged in")

    const skip = (why) => {
      job.skipped = (job.skipped ?? 0) + 1
      return nextListing(job, `Skipped one (${why}). Sent ${job.offered ?? 0} so far.`)
    }
    const counts = await loadCounts()
    if (!P.remaining(counts, "offers", job.caps?.offers)) return finish(job, `Sent ${job.offered ?? 0} offers, which reaches today's limit of ${P.cap("offers", job.caps?.offers)}.`)
    if (counts.offered.includes(id)) return skip("already offered today")

    const priceCents = FL.offerPrice(document.documentElement.outerHTML)
    const offer = P.offerCents(priceCents, job.options?.percent, job.options?.floorCents)
    if (priceCents == null) return skip("couldn't read its price")
    if (offer == null) return skip("your floor leaves less than Poshmark's 10% minimum discount")

    // Only listings with likes have the button.
    const open = await D.waitFor(() => D.findButton(/^offer to likers$/i), 4000)
    if (!open) return skip("no likers")
    open.click()
    const box = await D.waitFor(
      () => dialogs().flatMap((d) => [...d.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox])')]).find(D.visible),
      6000,
    )
    check(job, "listing")
    if (!box) throw new Stop("the Offer to Likers form didn't open the way FlipLedger expected")
    D.setValue(box, FL.wholeDollars(offer))
    await D.sleep(600)

    // Submit (some versions ask again to confirm). The offer is done when the dialog closes.
    for (let step = 0; step < 3 && dialogs().length; step++) {
      const btn = inDialog(/^(submit|send|send offer|apply|next|done|confirm|yes)$/i)
      if (!btn || btn.disabled || btn.getAttribute("aria-disabled") === "true") break
      btn.click()
      await D.waitFor(() => !dialogs().length, 4000)
      check(job, "listing")
    }
    if (dialogs().length) {
      const said = (inDialog(/./)?.innerText ?? "").trim().split("\n")[0]?.slice(0, 120)
      await closeDialog()
      check(job, "listing")
      throw new Stop(`Poshmark didn't take the offer${said ? ` ("${said}")` : ""}`)
    }
    const after = await count("offers", id)
    job.offered = (job.offered ?? 0) + 1
    return nextListing(job, `Sent ${job.offered} offer${job.offered === 1 ? "" : "s"} (last one $${FL.wholeDollars(offer)}; ${after.offers} today).`)
  }

  // ---------- routing ----------

  let running = false
  let lastPath = ""
  async function route() {
    if (running || location.pathname === lastPath) return
    lastPath = location.pathname
    const { job } = (await send({ type: "GET_JOB" }).catch(() => null)) ?? {}
    if (!job || !KINDS.includes(job.kind)) return
    running = true
    try {
      if (job.kind === "offer_likers") {
        if (job.queue?.length) await offerOnListing(job)
        else await offersFromCloset(job)
      } else {
        await share(job)
      }
    } catch (e) {
      if (e instanceof Stop) await halt(job, e.message)
      else await halt(job, `something unexpected happened (${String(e?.message ?? e)})`)
    } finally {
      running = false
    }
  }

  route()
  setInterval(route, 1000)
})()
