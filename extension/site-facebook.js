// Facebook Marketplace: what runner.js needs to know about facebook.com/marketplace.
;(function () {
  const FL = globalThis.FL
  const D = globalThis.FLDOM

  globalThis.FL_SITE = {
    id: "facebook",
    name: "Facebook",
    origin: "https://www.facebook.com",
    photoLimit: 10,
    itemPattern: /\/marketplace\/item\/\d+/,
    isCreatePage: (path) => path.startsWith("/marketplace/create"),
    isAfterPublish: (path) => /^\/marketplace\/(you\/selling|item\/\d+)/.test(path),
    ready: () => D.findField("Title"),
    yourTurn: "pick a Category",
    publishHint: "click Next and Publish",

    async fill(l, photos) {
      const done = []
      const todo = []
      const step = (ok, label) => (ok ? done : todo).push(label)
      if (await D.setPhotos(photos)) done.push(`${photos.length} photo${photos.length === 1 ? "" : "s"}`)
      else todo.push("Add photos")
      const title = D.findField("Title")
      step(!!title && D.setValue(title, l.title.slice(0, 99)), "Title")
      const price = D.findField("Price")
      step(!!price && D.setValue(price, FL.wholeDollars(l.priceCents)), "Price")
      const cond = FL.facebookCondition(l.condition)
      step(!!cond && !!(await D.chooseOption("Condition", cond)), cond ? `Condition (${cond})` : "Condition")
      const desc = D.findField("Description")
      step(!!desc && D.setValue(desc, FL.listingText(l)), "Description")
      return { done, todo }
    },

    delist: {
      buttons: [/^mark as sold$/i],
      hint: 'Click "Mark as sold" (highlighted), or delete the listing.',
      fallback: "mark it as sold or delete it",
      isGone: () =>
        !!D.findButton(/^mark as (available|in stock)$/i) || /this listing is no longer available|listing deleted/i.test(document.body.innerText),
    },
  }
})()
