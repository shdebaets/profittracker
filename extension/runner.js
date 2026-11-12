// Runs on each supported marketplace, driven by that site's config (globalThis.FL_SITE,
// from site-*.js). For a FlipLedger job in this tab it:
//  - list:   fills the create-listing form, then stops so the seller checks it and
//            publishes (or, if the seller turned on auto-publish, publishes after a
//            countdown when everything got filled); reports the listing back to FlipLedger.
//  - delist: highlights the button that takes the listing down and reports back once
//            it's gone (or the seller clicks Done).
// It only publishes or deletes by itself when the seller turned that on in FlipLedger.
;(function () {
  const FL = globalThis.FL
  const D = globalThis.FLDOM
  const site = globalThis.FL_SITE
  if (!site || window.__flipledgerRunner) return
  window.__flipledgerRunner = true

  const send = (msg) => chrome.runtime.sendMessage(msg)

  // ---------- list ----------

  let busy = false
  async function fillListing(job, photos) {
    if (busy) return
    busy = true
    try {
      D.panel({ title: "Filling your listing…", lines: ["Hang on a few seconds."] })
      await D.waitFor(site.ready, 20000)
      const { done, todo } = await site.fill(job.listing, photos)
      await send({ type: "UPDATE", patch: { state: "filled" } })
      if (job.autoPublish && !todo.length) return await autoPublish(job, done)
      showFilled(job, done, todo)
    } catch (e) {
      D.panel({
        title: "Couldn't fill everything",
        lines: [String(e?.message ?? e), "You can still finish the listing by hand."],
        buttons: [{ label: "I published it", primary: true, onClick: () => finishListing(job) }, { label: "Cancel", onClick: () => cancel(String(e)) }],
      })
    } finally {
      busy = false
    }
  }

  function showFilled(job, done, todo, note) {
    D.panel({
      title: "Ready for you",
      lines: [
        `Filled: ${done.join(", ") || "nothing"}.`,
        ...(site.yourTurn.length + todo.length ? [`Your turn: ${[...todo, ...site.yourTurn].join(", ")}.`] : []),
        `Check everything${done.some((d) => d.startsWith("Category")) ? ", especially the category FlipLedger guessed" : ""}, then ${site.publishHint}. FlipLedger records it automatically.`,
        ...(note ? [note] : []),
      ],
      buttons: [
        { label: "I published it", primary: true, onClick: () => finishListing(job) },
        { label: "Cancel", onClick: () => cancel(`You cancelled the ${site.name} listing`) },
      ],
    })
  }

  // ---------- auto-publish (only when the seller turned it on in FlipLedger) ----------
  // Counts down so the seller can stop it, then clicks through the site's publish steps
  // (e.g. Next, then Publish). Gives the listing back to the seller if a button is
  // missing or still disabled, which means the site wants something we didn't fill.

  const disabled = (b) => b.disabled || b.getAttribute("aria-disabled") === "true"

  async function autoPublish(job, done) {
    let stopped = false
    for (let s = 5; s > 0 && !stopped; s--) {
      D.panel({
        title: `Publishing in ${s}…`,
        lines: [`Filled: ${done.join(", ")}.`, "Stop to check it yourself first."],
        buttons: [{ label: "Stop", primary: true, onClick: () => (stopped = true) }],
      })
      await D.sleep(1000)
    }
    if (stopped) return showFilled(job, done, [])
    const { steps } = site.publish
    const final = steps.at(-1)
    for (let click = 0; click < steps.length + 1; click++) {
      const btn = await D.waitFor(() => D.findButton(final) || steps.slice(0, -1).map(D.findButton).find(Boolean), 10000)
      if (!btn || disabled(btn)) {
        return showFilled(job, done, [], `Didn't publish by itself: ${btn ? `the site's "${btn.innerText.trim()}" button isn't ready, so it wants something filled in` : "couldn't find the Publish button"}.`)
      }
      const isFinal = final.test((btn.getAttribute("aria-label") || btn.innerText || "").trim())
      btn.click()
      if (isFinal) {
        // Routing records it once the site shows the new listing. Still on the form
        // means the site turned it down (usually a required field we didn't fill).
        D.panel({ title: "Publishing…", lines: ["Waiting for the site to post it."] })
        if (await D.waitFor(() => !site.isCreatePage(location.pathname), 15000)) return
        return showFilled(job, done, [], "Didn't publish by itself: the site kept the form open, so check it for anything marked required.")
      }
      await D.sleep(1500)
    }
    showFilled(job, done, [], "Didn't publish by itself: the publish steps didn't finish.")
  }

  let finishing = false
  async function finishListing(job) {
    if (finishing) return
    finishing = true
    D.panel({ title: "Recording it…", lines: ["Looking for your new listing."] })
    const here = location.href.match(site.itemPattern)
    const url = here
      ? location.href.slice(0, here.index + here[0].length)
      : await D.waitFor(() => FL.findListingHref(document.querySelectorAll("a[href]"), job.title, site.itemPattern, site.origin), 6000)
    await send({ type: "DONE", url })
    D.panel({ title: "Done", lines: ["Saved in FlipLedger. You can close this tab."], buttons: [{ label: "Close", onClick: D.closePanel }] })
  }

  async function cancel(reason) {
    await send({ type: "CANCEL", reason })
    D.closePanel()
  }

  // ---------- delist ----------

  let delistWatch = null
  async function guideDelist(job) {
    // Point at the first step that's on this page (e.g. "Edit", then "Delete" on the edit page).
    const btn = await D.waitFor(() => site.delist.buttons.map(D.findButton).find(Boolean), 8000)
    if (btn) {
      btn.style.outline = "3px solid #f59e0b"
      btn.style.outlineOffset = "2px"
      btn.scrollIntoView({ block: "center" })
    }
    D.panel({
      title: "Sold elsewhere",
      lines: [`"${job.title}" sold on another marketplace.`, btn ? site.delist.hint : `Open the listing, then ${site.delist.fallback}.`],
      buttons: [
        { label: "Done", primary: true, onClick: () => finishDelist() },
        { label: "Cancel", onClick: () => cancel("Delisting cancelled") },
      ],
    })
    clearInterval(delistWatch)
    delistWatch = setInterval(() => {
      if (site.delist.isGone()) finishDelist()
    }, 1500)
  }
  async function finishDelist() {
    clearInterval(delistWatch)
    await send({ type: "DONE" })
    D.panel({ title: "Done", lines: ["Marked as ended in FlipLedger."], buttons: [{ label: "Close", onClick: D.closePanel }] })
  }

  // ---------- auto-delist (only when the seller turned it on in FlipLedger) ----------
  // Runs in a background tab. It only clicks on a page carrying this listing's ID. If anything
  // looks wrong it stops and reports, and the listing stays on the seller's delist list.

  let autoBusy = false
  const autoFail = (reason) => send({ type: "CANCEL", reason: `${site.name}: couldn't delist automatically (${reason}). It's still on your delist list.` })

  async function autoDelist(job) {
    if (autoBusy) return
    autoBusy = true
    const own = FL.listingId(site.id, job.url)
    const onOwnPage = () => !!own && location.pathname.includes(own)
    if (job.state === "deleting") {
      // The delete reloaded the page. Back on some other page means the listing is gone.
      if (!onOwnPage() || site.delist.isGone()) return send({ type: "DONE" })
      return autoFail("the listing is still up")
    }
    if (!onOwnPage()) return autoFail("it opened a different page")
    if (site.delist.isGone()) return send({ type: "DONE" })

    const { open, final, confirm } = site.delist.auto
    const btn = await D.waitFor(() => D.findButton(final) || (open && D.findButton(open)), 10000)
    if (!btn) return autoFail("the button wasn't there")
    if (!final.test((btn.getAttribute("aria-label") || btn.innerText || "").trim())) {
      // A step on the way (e.g. Edit). Routing carries on when the new page shows.
      const from = location.pathname
      btn.click()
      autoBusy = false
      await D.sleep(15000)
      if (location.pathname === from) autoFail("the next page didn't open")
      return
    }

    await send({ type: "UPDATE", patch: { state: "deleting" } })
    btn.click()
    const inDialog = () =>
      [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[class*="modal"]')]
        .flatMap((d) => [...d.querySelectorAll('button,[role="button"]')])
        .find((b) => D.visible(b) && confirm.test((b.getAttribute("aria-label") || b.innerText || "").trim()))
    const yes = await D.waitFor(inDialog, 4000)
    if (yes) yes.click()
    const gone = await D.waitFor(() => !onOwnPage() || site.delist.isGone(), 15000, 500)
    return gone ? send({ type: "DONE" }) : autoFail("the listing is still up")
  }

  // ---------- import (the seller's listings page) ----------
  // Collects the links to the seller's own listings; the background worker then reads
  // each listing's public page. Scrolls (or clicks "Load more") until no more show up.
  // The tab has to stay in front: background tabs don't render, so the list stops growing.

  let importing = false
  async function collectListings(job) {
    const sold = job.kind === "sales"
    const pattern = sold ? (site.soldPattern ?? site.itemPattern) : site.itemPattern
    if (importing) return
    importing = true
    if (/\/(login|signin|signup)/i.test(location.pathname)) {
      return send({ type: "CANCEL", reason: `Log in to ${site.name} in this Chrome window, then import again.` })
    }
    D.panel({
      title: sold ? "Reading your sales…" : "Importing your listings…",
      lines: [`Leave this tab open while it scrolls through your ${sold ? "sold items" : "listings"}.`, "It closes by itself and goes back to FlipLedger."],
    })
    const links = () => {
      const urls = new Set()
      for (const a of document.querySelectorAll("a[href]")) {
        const m = a.href.match(pattern)
        if (m) urls.add(a.href.slice(0, m.index + m[0].length))
      }
      return urls
    }
    // An empty sold list has no links at all, so don't wait as long.
    await D.waitFor(() => links().size, sold ? 8000 : 15000)
    let last = -1
    for (let round = 0; round < 40 && links().size !== last; round++) {
      last = links().size
      // Step back first: a page that's already at the bottom (restored scroll) wouldn't move or load.
      window.scrollTo(0, Math.max(0, document.body.scrollHeight - 2 * innerHeight))
      await D.sleep(150)
      window.scrollTo(0, document.body.scrollHeight)
      // Scroll events only fire on rendered frames; nudge pages that listen for them.
      window.dispatchEvent(new Event("scroll"))
      D.findButton(/^(load|show|see) more( items| listings)?$/i)?.click()
      await D.sleep(1500)
    }
    return send({ type: "DONE", urls: [...links()] })
  }

  // ---------- routing (these sites are single-page apps, so watch the URL) ----------

  let lastPath = ""
  async function route() {
    if (location.pathname === lastPath) return
    lastPath = location.pathname
    const onCreate = site.isCreatePage(location.pathname)
    const { job, photos } = (await send({ type: "GET_JOB", withPhotos: onCreate })) ?? {}
    if (!job) return
    if (job.kind === "import" || job.kind === "sales") return collectListings(job)
    if (job.kind === "list") {
      if (onCreate) return fillListing(job, (photos ?? []).slice(0, site.photoLimit))
      // The site lands on the new listing (or your listings) after publishing.
      if (job.state === "filled" && site.isAfterPublish(location.pathname)) return finishListing(job)
    } else {
      return job.auto ? autoDelist(job) : guideDelist(job)
    }
  }

  route()
  setInterval(route, 1000)
})()
