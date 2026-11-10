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
- **Screenshots:** at least one, 1280×800 (or 640×400). Good ones: the FlipLedger Cross-list sheet with Auto-fill, and a Poshmark or Mercari form after it's filled with the FlipLedger panel showing.
- **Homepage URL:** https://profit.emoneydeals.com
- **Description:**

> FlipLedger Lister is the companion to FlipLedger, the profit tracker and cross-lister for resellers. It needs a FlipLedger account.
>
> • Cross-list in a click: from FlipLedger, open Facebook Marketplace, Poshmark or Mercari with your photos, title, description, price, condition, brand, size and category already filled in. You review it and publish, or turn on auto-publish.
> • Delist when it sells: when an item sells anywhere, FlipLedger lists the other listings to take down, and the extension removes them for you (automatically if you turn that on).
> • Catch sales: while FlipLedger is open, the extension checks your Mercari and Poshmark listings and records sales in FlipLedger.
> • Import what you already have: bring your live Mercari listings into FlipLedger as inventory.
> • Research before you buy: when you open an item in FlipLedger Research, the extension reads eBay's sold results for it so you see real sold prices and how fast it sells.
>
> It works in your own logged-in browser and never sees your marketplace passwords. It doesn't share, follow or relist for you.

## Privacy practices tab

- **Single purpose:** Connects the user's marketplace accounts to FlipLedger: fills in, publishes and removes their own Facebook Marketplace, Poshmark and Mercari listings, reports those listings' status back, and reads eBay sold-price results for items they research in FlipLedger.
- **Permission justifications:**
  - `storage`: keeps each in-progress list, delist or import task (in session storage) while its marketplace tab loads, because the service worker can be suspended in between.
  - `scripting`: reads eBay's sold search results page in a background eBay tab when the user researches an item in FlipLedger (the page's parser is packaged with the extension, `ebay-sold.js`).
  - Host `www.ebay.com`: opens eBay's public sold search results for the item the user is researching and reads the sold prices and dates; nothing is posted to eBay.
  - Host `facebook.com`, `poshmark.com`, `mercari.com`: fills in the listing form on these sites, clicks the publish or delete buttons the user asked for, and reads the user's own listing pages to check whether they sold.
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
