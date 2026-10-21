# FlipLedger Lister (Chrome extension)

Facebook Marketplace has no API for posting listings on someone's behalf, so this extension does it in the seller's own logged-in browser, the same way Vendoo and Flyp do. Desktop Chrome only.

## What it does

- **List:** in FlipLedger, Cross-list → Facebook → **Auto-fill on Facebook**. A Facebook tab opens and the extension fills in the photos, title, price, condition and description. The seller picks a category and clicks **Publish** themselves. The extension then records the listing, with its link, in FlipLedger.
- **Delist:** when the item sells elsewhere, the "Delist these" banner (or the Facebook row) has a ✨ button. It opens the listing, highlights **Mark as sold**, and marks it ended in FlipLedger once that's done.
- The extension never publishes or deletes anything by itself, and it never sees your Facebook password.

## Install (until it's on the Chrome Web Store)

1. Download this `extension` folder, or zip it and send it to the user.
2. In Chrome, open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension` folder.
4. Reload FlipLedger. The Facebook row in Cross-list now shows **Auto-fill on Facebook**.

## Files

| File | Runs on | Job |
| --- | --- | --- |
| `shared.js` | everywhere | Pure helpers (condition mapping, link finding); unit-tested in `shared.test.ts` |
| `content-app.js` | the FlipLedger site | Relays messages between the page and the extension |
| `background.js` | service worker | Opens marketplace tabs, holds each job, sends results back |
| `content-facebook.js` | facebook.com/marketplace | Fills the form, shows the FlipLedger panel, detects publish / mark-as-sold |

## Notes

- Fields are found by their visible labels ("Title", "Price", "Condition", "Description"), not Facebook's generated class names. If Facebook renames a field, the panel lists it under "Your turn" instead of failing silently.
- The FlipLedger app's address is listed in `manifest.json` (`content_scripts.matches`). Add any new domain there.
- Tested against a React mock of the listing form. It has **not yet been run on the real facebook.com.**
- To publish on the Chrome Web Store: zip the folder, then pay the one-time developer fee and submit at https://chrome.google.com/webstore/devconsole.
