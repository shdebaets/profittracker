# Chrome Web Store submission

What to paste into the Chrome Web Store developer dashboard (https://chrome.google.com/webstore/devconsole). The account should be the client's: whoever owns it owns the listing. Keep this file in step with `manifest.json` when permissions change.

## Upload

```bash
npm run pack:extension   # → dist/flipledger-extension-<version>.zip
```

Bump `version` in `manifest.json` before every update; the store rejects a version it has seen. Each update is reviewed again.

## Store listing tab

- **Name:** FlipLedger Lister (from the manifest)
- **Summary:** from the manifest description
- **Category:** Shopping (or Productivity → Tools)
- **Language:** English
- **Icon:** `extension/icons/icon-128.png`
- **Screenshots:** at least one, 1280×800 (or 640×400). Good ones: the FlipLedger Cross-list sheet with Auto-fill, a Poshmark or Mercari form after it's filled with the FlipLedger panel showing, and Settings → Poshmark Assistant.
- **Reviewer note** (in the submission's notes field, for 0.8.0): "Adds the optional Poshmark Assistant. It's off by default and only acts on the user's own Poshmark closet and listings, while the tab it opened stays open, with random 3–8 second waits, daily limits (300 shares, 50 offers) and an immediate stop on captchas or rate-limit messages. No new permissions." If the store rejects it, the plan is to move the assistant into its own extension.
- **Homepage URL:** https://profit.emoneydeals.com
- **Description:**

> FlipLedger Lister is the companion to FlipLedger, the profit tracker and cross-lister for resellers. It helps you manage your own listings on resale sites from FlipLedger. It needs a FlipLedger account.
>
> • Cross-list in a click: from FlipLedger, open Facebook Marketplace, Poshmark or Mercari with your photos, title, description, price, condition, brand, size and category already filled in. You review it and publish, or turn on auto-publish.
> • Delist when it sells: when an item sells anywhere, FlipLedger lists the other listings to take down, and the extension removes them for you (automatically if you turn that on).
> • Catch sales: while FlipLedger is open, the extension checks your Mercari and Poshmark listings and records sales in FlipLedger.
> • Import what you already have: bring your live Mercari listings into FlipLedger as inventory.
> • Poshmark Assistant (optional, off until you turn it on): share your own closet, share your listings to the live party, and send Offer to Likers at the discount you choose, never under your floor price. It runs only while its tab is open, waits a few seconds between actions, keeps to daily limits, and stops if Poshmark asks it to.
>
> It works in your own logged-in browser, only on your own listings, and never sees your marketplace passwords.

## Privacy practices tab

- **Single purpose:** Manages the user's own listings on resale sites (Facebook Marketplace, Poshmark, Mercari) from their FlipLedger inventory: fills in, publishes, shares, sends offers on and removes those listings when the user asks, and reports their status back to FlipLedger.
- **Permission justifications:**
  - `storage`: keeps each in-progress list, delist, import or Poshmark Assistant task (in session storage) while its marketplace tab loads, because the service worker can be suspended in between, and counts the Poshmark Assistant's shares and offers for the day (in local storage) so it keeps to its daily limits.
  - Host `facebook.com`, `poshmark.com`, `mercari.com`: fills in the listing form on these sites, clicks the publish, delete, share or offer buttons the user asked for on their own listings, and reads the user's own listing pages to check whether they sold.
  - Host `*.supabase.co`: downloads the user's item photos from FlipLedger's storage to attach them to the listing form.
  - Content script on `profit.emoneydeals.com` (and the old `profittracker-iye3.vercel.app`): receives the listing to post from the FlipLedger app and sends results back.
- **Remote code:** No, I am not using remote code. (All JavaScript ships in the package.)
- **Data usage**, tick:
  - *Personally identifiable information*: no.
  - *Website content*: yes (it reads the user's own listing pages and listing details to report them to FlipLedger).
  - Leave the rest unticked: no health, financial, authentication, personal communications, location, web history or user activity data.
- **Certify:** not sold to third parties; not used for purposes unrelated to the single purpose; not used for creditworthiness or lending.
- **Privacy policy URL:** https://profit.emoneydeals.com/privacy

## Distribution tab

Public since 0.6.1 (Nov 2026): https://chromewebstore.google.com/detail/flipledger-lister/cagenhmfjlembnkfonjocdjjbdicimgp. The app links to it through `EXTENSION_STORE_URL` in `lib/marketplaces/registry.ts`. 0.6.0 was rejected for requesting `tabs` without using it.
