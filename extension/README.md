# FlipLedger Lister (Chrome extension)

Facebook Marketplace, Poshmark and Mercari have no API for posting listings on someone's behalf. This extension does it in the seller's own logged-in browser, the same way Vendoo, List Perfectly and Crosslist do. Desktop Chrome only.

Poshmark's and Mercari's terms ban automation. Sellers using these tools accept that risk; accounts there have been flagged for share/follow bots and high-volume automation, not for filling in a form the seller then submits. This extension never shares, follows, relists or submits anything by itself.

## What it does

- **List:** in FlipLedger, Cross-list → Facebook / Poshmark / Mercari → **Auto-fill**. The site opens in a new tab and the extension fills in what it can:
  - **Facebook:** photos, title, price, condition, description. The seller picks a category.
  - **Poshmark:** photos, title, description, brand, listing price, condition. The seller picks category and size and enters the original price.
  - **Mercari:** photos, title, description, condition, price. The seller picks category, brand and shipping.

  The seller checks it and clicks **Publish** (or List) themselves. The extension then records the listing, with its link, in FlipLedger.
- **Spot sales (Mercari, plus Poshmark as a backup):** while FlipLedger is open (on load, when the tab comes back into focus, at most every 5 minutes), the extension fetches each live listing's public page and reads that listing's own status. A sold listing becomes a sale in FlipLedger, which puts every other listing of that item on the delist list (and ends eBay automatically). Normally no cookies are sent, because sold status is public; if Mercari's Cloudflare check answers, it retries once with the seller's own clearance. FlipLedger's server checks Poshmark itself, so Poshmark doesn't depend on this. Servers can't read Mercari, so Mercari does.
- **Delist:** the "Delist these" banner (or the marketplace row) has a ✨ button. It opens the listing and highlights the next button to click (Facebook: **Mark as sold**; Poshmark: **Edit Listing** → **Delete Listing**; Mercari: **Edit** → **Delete** / **Deactivate**). It marks the listing ended in FlipLedger once the page shows it's gone. For Poshmark and Mercari, the next sale check also confirms a takedown on its own.
- It never sees your marketplace passwords.

## Install (until it's on the Chrome Web Store)

1. Download this `extension` folder, or zip it and send it to the user.
2. In Chrome, open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension` folder.
4. Reload FlipLedger. The Facebook, Poshmark and Mercari rows in Cross-list now show **Auto-fill**.

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
