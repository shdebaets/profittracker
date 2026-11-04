# FlipLedger Lister (Chrome extension)

Facebook Marketplace, Poshmark and Mercari have no API for posting listings on someone's behalf. This extension does it in the seller's own logged-in browser, the same way Vendoo, List Perfectly and Crosslist do. Desktop Chrome only.

Poshmark's and Mercari's terms ban automation. Sellers using these tools accept that risk; accounts there have been flagged for share/follow bots and high-volume automation, not for filling in a form the seller then submits. This extension never shares, follows or relists. It only submits or removes a listing by itself when the seller turns on auto-publish or auto-delist (both below, both off by default).

## What it does

- **List:** in FlipLedger, Cross-list → Facebook / Poshmark / Mercari → **Auto-fill**. The site opens in a new tab and the extension fills in what it can:
  - **Facebook:** photos, title, price, category, condition, description, brand.
  - **Poshmark:** photos, title, description, category, size, brand, listing price, condition. The seller enters the original price.
  - **Mercari:** photos, title, description, category, size, brand, condition, price. The seller picks shipping.

  The category is a guess from the title (`guessCategory` / `categoryPath` in `shared.js`): what the item is (sneakers, hoodie, video game…) and, for clothing, whose department (women, men, kids). Clothing with no department in the title is left for the seller, and so is any menu level the site doesn't show. The panel says what was guessed so the seller checks it.

  The seller checks it and clicks **Publish** (or List) themselves. The extension then records the listing, with its link, in FlipLedger.
- **Publish automatically (off by default):** a seller can turn this on per computer in Settings. After filling, if nothing was left over, the panel counts down 5 seconds (with **Stop**), then clicks the site's publish steps (`publish.steps` in each `site-*.js`: Facebook **Next** → **Publish**, Poshmark **Next** → **List This Item**, Mercari **List**). A missing or disabled button, or a site that keeps the form open after the last click, hands the listing back to the seller with a note.
- **Import Mercari listings:** Settings → Import listings → **Import from Mercari**. The extension opens the seller's Mercari listings page in a new tab, scrolls until every listing has loaded, closes the tab, then reads each listing's public page (`FL.mercariItem`: title, description, price, brand and photo from the page's schema.org Product data, plus Mercari's own status, so only listings still for sale come back). The tab has to stay in front, because Chrome doesn't render background tabs and the list stops loading. The seller must be logged in to Mercari in that Chrome. (Poshmark imports run on FlipLedger's server instead, from the public closet.)
- **Spot sales (Mercari, plus Poshmark as a backup):** while FlipLedger is open (on load, when the tab comes back into focus, at most every 5 minutes), the extension fetches each live listing's public page and reads that listing's own status. A sold listing becomes a sale in FlipLedger, which puts every other listing of that item on the delist list (and ends eBay automatically). Normally no cookies are sent, because sold status is public; if Mercari's Cloudflare check answers, it retries once with the seller's own clearance. FlipLedger's server checks Poshmark itself, so Poshmark doesn't depend on this. Servers can't read Mercari, so Mercari does.
- **Delist:** the "Delist these" banner (or the marketplace row) has a ✨ button. It opens the listing and highlights the next button to click (Facebook: **Mark as sold**; Poshmark: **Edit Listing** → **Delete Listing**; Mercari: **Edit** → **Delete** / **Deactivate**). It marks the listing ended in FlipLedger once the page shows it's gone. For Poshmark and Mercari, the next sale check also confirms a takedown on its own.
- **Delist automatically (off by default):** a seller can turn this on per computer in Settings. Listings waiting to come down then open in background tabs and get removed: Facebook **Mark as sold**, Poshmark **Delete Listing**, Mercari **Deactivate**. It only clicks on a page carrying that listing's ID, and only when the listing has a saved link. Anything unexpected closes the tab and leaves the listing on the delist list.
- It never sees your marketplace passwords.

## Install

Sellers install it from the Chrome Web Store: https://chromewebstore.google.com/detail/flipledger-lister/cagenhmfjlembnkfonjocdjjbdicimgp (linked in the app as `EXTENSION_STORE_URL` in `lib/marketplaces/registry.ts`). Chrome keeps it updated.

Publishing to the store: see `STORE.md`. `npm run pack:extension` builds the zip to upload.

To try local changes, load it unpacked (remove the store version first, or both will run):

1. In Chrome, open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick the `extension` folder.
3. Reload FlipLedger. The Facebook, Poshmark and Mercari rows in Cross-list now show **Auto-fill**.

## Files

| File | Runs on | Job |
| --- | --- | --- |
| `shared.js` | everywhere | Pure helpers (condition mapping, link finding, sold-page parsing); unit-tested in `shared.test.ts` |
| `content-app.js` | the FlipLedger site | Relays messages between the page and the extension |
| `background.js` | service worker | Opens marketplace tabs, holds each job, sends results back, runs sale checks |
| `dom.js` | marketplace sites | Finds fields by label/placeholder, fills them, draws the FlipLedger panel |
| `runner.js` | marketplace sites | The list / record / delist flow, driven by the site's config |
| `site-facebook.js`, `site-poshmark.js`, `site-mercari.js` | that site | What's specific to each site: field names, URLs, delist buttons |

To add a site: write a `site-*.js` config, add a `content_scripts` entry and host permission in `manifest.json`, add it to `SITES` in `background.js` and `MARKETPLACES` in `shared.js`, and set `extension: true` on it in the app's `lib/marketplaces/registry.ts`.

## Notes

- Fields are found by what the seller sees (label, placeholder), not the sites' generated class names. If a site renames a field, the panel lists it under "Your turn" instead of failing silently.
- The FlipLedger app's address is listed in `manifest.json` (`content_scripts.matches`). Add any new domain there.
- Facebook was tested against a React mock of its listing form; Poshmark and Mercari against simple HTML mocks. **None of them has been run on the real sites yet.**
- To publish on the Chrome Web Store: zip the folder, then pay the one-time developer fee and submit at https://chrome.google.com/webstore/devconsole.
