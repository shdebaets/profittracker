// Poshmark: what runner.js needs to know about poshmark.com.
;(function () {
  const FL = globalThis.FL
  const D = globalThis.FLDOM

  const TITLE = ["Title", "What are you selling?"]

  globalThis.FL_SITE = {
    id: "poshmark",
    name: "Poshmark",
    origin: "https://poshmark.com",
    photoLimit: 16,
    itemPattern: /\/listing\/[^/?#]*-[0-9a-f]{24}/,
    isCreatePage: (path) => path.startsWith("/create-listing"),
    isAfterPublish: (path) => /^\/(listing|closet)\//.test(path),
    ready: () => D.findField(TITLE),
    yourTurn: "pick Category and Size, enter Original Price, check Brand",
    publishHint: "click Next and List This Item",

    async fill(l, photos) {
      const done = []
      const todo = []
      const step = (ok, label) => (ok ? done : todo).push(label)
      if (await D.setPhotos(photos)) done.push(`${photos.length} photo${photos.length === 1 ? "" : "s"}`)
      else todo.push("Add photos")
      const title = D.findField(TITLE)
      step(!!title && D.setValue(title, l.title.slice(0, 80)), "Title")
      const desc = D.findField(["Description", "Describe it!"])
      step(!!desc && D.setValue(desc, FL.listingText(l).slice(0, 1500)), "Description")
      if (l.brand) {
        const brand = D.findField(["Brand", "Enter the Brand/Designer"])
        step(!!brand && D.setValue(brand, l.brand), "Brand")
      }
      const price = D.findField(["Listing Price"])
      step(!!price && D.setValue(price, FL.wholeDollars(l.priceCents)), "Listing Price")
      const choices = FL.conditionChoices("poshmark", l.condition)
      if (choices.length) {
        const picked = (await D.chooseOption("Condition", choices)) || D.chooseRadio(choices)
        step(!!picked, picked ? `Condition (${picked})` : "Condition")
      }
      return { done, todo }
    },

    delist: {
      // The listing page has "Edit Listing"; the edit page has "Delete Listing" at the bottom.
      buttons: [/^delete listing$/i, /^edit listing$/i],
      hint: 'Click the highlighted button: "Edit Listing", then "Delete Listing" at the bottom (or set it Not For Sale).',
      fallback: "delete it or set it Not For Sale",
      // Not on the edit page: its Availability menu always says "Not For Sale".
      isGone: () =>
        !location.pathname.startsWith("/edit-listing") &&
        /listing (has been )?deleted|this listing is no longer available|not for sale/i.test(document.body.innerText),
    },
  }
})()
