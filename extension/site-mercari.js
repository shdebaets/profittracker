// Mercari: what runner.js needs to know about mercari.com.
;(function () {
  const FL = globalThis.FL
  const D = globalThis.FLDOM

  const TITLE = ["Title", "What are you selling?"]
  const ITEM_PAGE = /^\/(us\/)?item\/m\d+/

  globalThis.FL_SITE = {
    id: "mercari",
    name: "Mercari",
    origin: "https://www.mercari.com",
    photoLimit: 12,
    itemPattern: /\/(us\/)?item\/m\d+/,
    isCreatePage: (path) => /^\/(us\/)?sell\/?$/.test(path),
    isAfterPublish: (path) => ITEM_PAGE.test(path) || /^\/(us\/)?(mypage\/listings|sell\/(complete|success))/.test(path),
    ready: () => D.findField(TITLE),
    yourTurn: "pick Category, Brand and Shipping",
    publishHint: "click List",

    async fill(l, photos) {
      const done = []
      const todo = []
      const step = (ok, label) => (ok ? done : todo).push(label)
      if (await D.setPhotos(photos)) done.push(`${photos.length} photo${photos.length === 1 ? "" : "s"}`)
      else todo.push("Add photos")
      const title = D.findField(TITLE)
      step(!!title && D.setValue(title, l.title.slice(0, 80)), "Title")
      const desc = D.findField(["Description", "Describe your item"])
      step(!!desc && D.setValue(desc, FL.listingText(l).slice(0, 1000)), "Description")
      const choices = FL.conditionChoices("mercari", l.condition)
      if (choices.length) {
        const picked = D.chooseRadio(choices) || (await D.chooseOption("Condition", choices))
        step(!!picked, picked ? `Condition (${picked})` : "Condition")
      }
      const price = D.findField(["Price", "Listing price"])
      step(!!price && D.setValue(price, FL.wholeDollars(l.priceCents)), "Price")
      return { done, todo }
    },

    delist: {
      // The item page has "Edit"; the edit page has "Deactivate" and "Delete".
      buttons: [/^delete( item| listing)?$/i, /^deactivate( item| listing)?$/i, /^edit( item| listing)?$/i],
      // Deactivate, not delete: the seller can bring it back if this ever acts by mistake.
      auto: { open: /^edit( item| listing)?$/i, final: /^deactivate( item| listing)?$/i, confirm: /^(yes|deactivate|deactivate item|deactivate listing|confirm)$/i },
      hint: 'Click the highlighted button: "Edit", then "Delete" or "Deactivate".',
      fallback: "delete or deactivate it",
      isGone: () =>
        !!D.findButton(/^activate( item| listing)?$/i) ||
        /item (has been )?(deleted|deactivated)|this item is no longer available|item not found/i.test(document.body.innerText),
    },
  }
})()
