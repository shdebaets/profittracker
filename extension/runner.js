// Runs on each supported marketplace, driven by that site's config (globalThis.FL_SITE,
// from site-*.js). For a FlipLedger job in this tab it:
//  - list:   fills the create-listing form, then stops so the seller checks it and
//            publishes; reports the listing (with its link) back to FlipLedger.
//  - delist: highlights the button that takes the listing down and reports back once
//            it's gone (or the seller clicks Done).
// It never publishes or deletes anything by itself.
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
      D.panel({
        title: "Ready for you",
        lines: [
          `Filled: ${done.join(", ") || "nothing"}.`,
          `Your turn: ${[site.yourTurn, ...todo].join(", ")}.`,
          `Check everything, then ${site.publishHint}. FlipLedger records it automatically.`,
        ],
        buttons: [
          { label: "I published it", primary: true, onClick: () => finishListing(job) },
          { label: "Cancel", onClick: () => cancel(`You cancelled the ${site.name} listing`) },
        ],
      })
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

  // ---------- routing (these sites are single-page apps, so watch the URL) ----------

  let lastPath = ""
  async function route() {
    if (location.pathname === lastPath) return
    lastPath = location.pathname
    const onCreate = site.isCreatePage(location.pathname)
    const { job, photos } = (await send({ type: "GET_JOB", withPhotos: onCreate })) ?? {}
    if (!job) return
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
