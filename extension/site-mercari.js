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
    // Sold lists may link each sale to its transaction page instead of the item page.
    soldPattern: /\/(us\/)?(item|transaction)s?\/m\d+/,
    isCreatePage: (path) => /^\/(us\/)?sell\/?$/.test(path),
    isAfterPublish: (path) => ITEM_PAGE.test(path) || /^\/(us\/)?(mypage\/listings|sell\/(complete|success))/.test(path),
    ready: () => D.findField(TITLE),
    yourTurn: ["choose Shipping"],
    publishHint: "click List",
    /** Buttons auto-publish clicks, in order; the last one posts the listing. */
    publish: { steps: [/^list( item| now)?$/i] },

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
      await D.pickCategory("mercari", "Category", l, done, todo)
      if (l.brand) {
        const brand = await D.typeAndPick(["Brand", "Search brand"], l.brand)
        step(!!brand, brand ? `Brand (${brand})` : "Brand")
      } else todo.push("Brand (or No brand)")
      const choices = FL.conditionChoices("mercari", l.condition)
      if (choices.length) {
        const picked = D.chooseRadio(choices) || (await D.chooseOption("Condition", choices))
        step(!!picked, picked ? `Condition (${picked})` : "Condition")
      }
      const price = D.findField(["Price", "Listing price"])
      step(!!price && D.setValue(price, FL.wholeDollars(l.priceCents)), "Price")
      return { done, todo }
    },

    // Edit once, update everywhere: the item page's "Edit" opens the same form as selling.
    edit: {
      open: /^edit( item| listing)?$/i,
      isEditPage: (path) => /\/edit\b/.test(path),
      saveHint: 'click "Update" or "Save changes"',
      fields: { title: TITLE, description: ["Description", "Describe your item"], price: ["Price", "Listing price"] },
    },

    // Smart Offers (assisted): "Send offer" to likers on the item page; the seller sends it.
    offer: {
      open: /^(send( an)? offer|offer to likers|send offer to likers)$/i,
      fields: ["Offer price", "Your offer", "Price"],
      submitHint: 'click "Send offer"',
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
