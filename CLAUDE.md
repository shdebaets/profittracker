@AGENTS.md

# FlipLedger

Reseller profit tracker plus cross-lister. It's a PWA for many unrelated resellers: each user signs up and only ever sees their own data. The client is Nick (repo `shdebaets/profittracker`). Production runs at https://profit.emoneydeals.com on Vercel (the old https://profittracker-iye3.vercel.app still works; keep it in the extension manifest), with Supabase via the Vercel Marketplace integration.

## Keep this file current

Update CLAUDE.md in the same PR whenever you change something durable: architecture, a convention, a command, an env var, a marketplace decision, or a gotcha you hit. Remove anything that's no longer true. A Stop hook (`.claude/hooks/claude-md-reminder.sh`) prompts this when code changed without CLAUDE.md changing. If nothing durable changed, ignore it.

## Stack

- **Next.js 16.3** (App Router) and React 19. APIs differ from older Next; read `node_modules/next/dist/docs/` before writing routes, proxy or error code (see AGENTS.md).
  - `proxy.ts` replaces `middleware.ts`.
  - `error.tsx` and `global-error.tsx` get `retry()`.
  - Route handlers are typed with `RouteContext<"/path/[param]">`.
  - `route.ts` files may only export HTTP handlers and route config; put helpers in `lib/`.
- **Supabase:** Postgres with row-level security (RLS) on every table, no ORM, `@supabase/ssr`. Plus Storage (private `item-photos` bucket) and Auth (sessions; people sign in with Whop, see "Login and the Cross-Lister").
- **UI:** Tailwind v4, shadcn plus `@base-ui/react`, lucide icons, sonner toasts. Mobile-first: test at 375px.
- **Look:** from the client's Claude Design canvas. Fonts in `app/layout.tsx`: Inter (text), Space Grotesk (`h1`–`h3`, `font-heading`), JetBrains Mono (`font-mono`, for money). Colors are hex tokens in `app/globals.css`: the app is light (`:root`), the sign-in page uses the design's dark landing look (`.dark`). Brand orange `#f5982a`, profit green `#0e8f55`.
- **zod 4** for every server-action input. **vitest** for unit tests.

## Commands

```bash
npm run dev            # next dev on :3000
npm test               # vitest
npx tsc --noEmit       # typecheck (run `npx next typegen` first in a fresh worktree)
npm run lint
npm run build
```

Local Supabase needs Docker. Start it without the analytics stack; Logflare fails its health check and takes the whole start down:

```bash
npx supabase start -x logflare,vector,studio,edge-runtime,realtime,supavisor,postgres-meta
npx supabase migration up --local
```

Local QA logins live in `.env.example` (`qa-a@flipledger.test`, `qa-b@flipledger.test`). Only use them against local Supabase.

## Architecture

- **Mutations** are server actions in `app/(app)/actions/*.ts`. Each one: zod-parse → `requireUser()` → Supabase call → `revalidatePath("/", "layout")`. It returns `ActionResult`, and every catch goes through `fail(e)`.
- **Reads** are in `lib/data.ts` (server-only). `getItems()` also signs photo URLs and joins `marketplace_listings`.
- **Login and the Cross-Lister** (`lib/whop/`):
  - **Sign in with Whop** only in production. The Whop app's redirect URI is `https://profit.emoneydeals.com/auth/whop/callback` (plus `http://localhost:3000/auth/whop/callback`); the callback URL is built from the request's host, and `*.vercel.app` redirects to the custom domain first. `/auth/whop/start` → Whop OAuth (PKCE, state in a cookie) → `/auth/whop/callback`. The callback reads Whop `userinfo`, finds the Supabase user (`whop_links.whop_user_id`, else the *verified* Whop email, which is how email-login accounts kept their data, else a new user), and mints a normal Supabase session with `admin.generateLink({ type: "magiclink" })` + `verifyOtp`. Whop tokens aren't stored.
  - **What's paid:** the profit tracker is free for anyone signed in. Cross-listing is the paid **Cross-Lister** (Whop product `prod_N6zbl5IfKlk7g`): eBay listing/connect, the extension (`ExtensionBridge`), `AutoSync` (sales sync and auto-delist), import, and every action in `actions/crosslist.ts` and `actions/import.ts`.
  - **Enforcement:** cross-listing actions call `requireCrosslister()` (throws a `UserError`); pages and the layout use `canCrosslist()` to swap the tools for `CrosslistUpsell`, which links to `/crosslister` (buy, "I already bought it", billing). `endListing({ manual: true })` stays open so lapsed members can clear delist alerts. Access = email in `FLIPLEDGER_FREE_EMAILS`, or Whop `checkAccess` says yes (customer or admin) for any of `WHOP_CROSSLIST_PRODUCT_IDS`. The answer is cached 10 minutes in `whop_links` (service-role only, no RLS policies, so users can't grant themselves access); if Whop errors, the last answer stands.
  - **Kill switches:** empty `WHOP_CROSSLIST_PRODUCT_IDS` = cross-listing open to everyone. Empty `WHOP_CLIENT_ID` = email login comes back. `ALLOW_EMAIL_LOGIN=1` shows the email form for local QA. Set the product IDs only after `WHOP_CLIENT_ID`: users who never signed in with Whop have no `whop_links` row and can't be granted the Cross-Lister.
  - The daily cron doesn't check access, so lapsed members' eBay sales still sync into their profit numbers.
  - **Linking an existing account:** if someone is already signed in (an older email-login account) when the Whop callback runs, `linkWhopToCurrentUser` attaches Whop to that account instead of matching by email, so a different Whop email can't make a second, empty account. `/crosslister` shows "Connect your Whop account" (`/auth/whop/start`) to signed-in users with no `whop_links` row. If someone signs in fresh with a Whop email that differs from their old FlipLedger email, they still get a new empty account; fix by pointing `whop_links.user_id` at the old user.
  - **Billing and the cancel flow** (`lib/whop/billing.ts`, `/crosslister`, `/crosslister/cancel`): reads the user's Cross-Lister memberships from Whop (`GET /memberships?user_id&product_ids&statuses`), shows plan and renewal date, and runs the cancel flow inside FlipLedger: their numbers (tax savings, miles, expenses, items), what turns off, then save offers before a cancel at period end. Offers: pause billing 1–3 months (`/memberships/{id}/pause` with `until`; Whop keeps access during a pause), a promo code on next renewals (`WHOP_SAVE_PROMO_CODE`, hidden when empty), and the yearly plan (`WHOP_CROSSLIST_ANNUAL_URL`). Once a yearly membership is live, `billingState` sets any monthly one to cancel at period end. Actions never take a membership id from the browser; they look it up from `whop_links`. Plans on Whop (eMoney Inner Circle, `biz_nfZESqY1ozpUqF`): $30/month `plan_t4m0Uu4JBQbM0`, $300/year `plan_6PimZZjEnRdYN`, plus a free one. The FlipLedger Whop app is `app_aRVAnzNgupBdws`; `WHOP_API_KEY` is a business key on eMoney Inner Circle.
- **Money** is always stored as integer cents. Profit math lives in `lib/profit.ts`.
- **Items:** `status` is `inventory | sold | returned`. A partial sale splits the row (`lib/items/sell.ts`). "Listed" isn't a status; it's derived from active `marketplace_listings` rows.
- **Photos:**
  - Up to 12 per item, compressed in the browser (`lib/image.ts`, 1600px JPEG).
  - Uploaded by direct PUT to signed upload URLs.
  - Stored at `item-photos/{user_id}/{uuid}.jpg`.
  - `photo_paths` is copied on partial sales, so delete files only with `removeUnreferencedPhotos`.
- **Errors:** `lib/errors.ts`.
  - Throw `UserError` for messages written for people.
  - Everything else is translated by `friendlyError()`: eBay, Supabase database/auth/storage, network, zod.
  - `fail()` and `reportError()` log the original. Never show raw `e.message` to users.
  - Crashed pages are handled by `app/(app)/error.tsx` and `app/global-error.tsx`.
- **Admin client:** `lib/supabase/admin.ts` uses the service role and bypasses RLS. It's only for cron, webhooks, the photo-link route, `marketplace_accounts` tokens and `marketplace_sales` writes (that table has no insert policy). Always scope by user yourself.

### Taxes

- `lib/tax.ts` (pure, tested) and the `/taxes` page. Every figure is an estimate; always show `TAX_DISCLAIMER`.
- **Tax bracket:** `settings.tax_bracket` (fraction, default 0.22) and `tax_bracket_set` (false until the seller picks one; the dashboard's `TaxSavingsCard` asks until then).
- **Tax savings** (dashboard and `/taxes`) = (COGS + mileage + expenses + subscriptions) × bracket for the calendar year.
- **Platform of a sale** (`salePlatform`): its sold cross-listing's marketplace, else the fee preset (`mercari_depop` counts as Mercari, `cash` as local).
- **1099-K Reconciler:** we don't get real 1099-K numbers or sales tax from marketplaces, so the seller types each form's gross into `tax_forms` (per year and platform). The difference from logged gross is shown as "sales tax or sales not logged here".
- **Schedule C:** expense categories map to lines in `SCHEDULE_C_EXPENSE_LINES`; meals are halved; labels and subscriptions go to 27a.
- **Quarterly estimates** use IRS periods (Jan–Mar, Apr–May, Jun–Aug, Sep–Dec; Q4 due Jan 15) and `estimatedTax` = 15.3% SE tax on 92.35% of net + bracket × (net − half SE).
- **PDF:** `/tax-report/[year]` is a plain printable page outside the `(app)` layout; the browser's "Save as PDF" makes the file.
- **Mileage log:** `expenses.start_location`/`end_location`. GPS trips save their first and last fix as "lat, lon"; manual trips take typed places.

### Lots, stale inventory, edit everywhere

- **Lots** are `hauls` (`lib/lots.ts`, `/lots`, `HaulForm`). Split mode `even` (same cost per unit) or `value` (by estimated resale value, `distributeHaul`), optional receipt photo (`hauls.receipt_path`, same `item-photos` bucket, path must start with the user's id). Items keep `haul_id`, also on partial-sale rows, so `lotStats` can show what a lot returned: sale revenue minus fees and labels, before the lot's cost; ROI = (returned − lot cost) / lot cost.
- **Stale alerts** (`lib/stale.ts`): an inventory item is stale after `settings.stale_days` (30/45/60/90/120, default 60) counted from its first live listing, else its purchase date. Dashboard card → `/inventory?filter=stale`, where `RepriceBar` drops prices by %, by $, or sets one (`repriceItems`, never below $0.99, from `askingPrice` = list price else highest live listing price).
- **Edit once, update everywhere** (`lib/crosslist/edit.ts`): `saveListingDetails` and `repriceItems` call `propagateToListings` with what changed. eBay is revised in place (`lib/marketplaces/ebay/revise.ts`: `bulk_update_price_quantity` for price/quantity, which answers 200 even when a line fails so check `responses[]`; title/description by GET + PUT of the inventory item, dropping read-only fields, plus the offer's `listingDescription`). Assisted sites get `marketplace_listings.sync_status = 'pending'` with `pending_changes`; failures get `failed` + `sync_error` and a Retry. The crosslist panel's `SyncNotice` shows each listing's state. `updateItem` also sends title, quantity and photo changes (`photoPaths`; eBay gets new `imageUrls` as short photo links on `APP_URL`). On assisted sites with extension 0.9.0+ (`extensionCanEdit`), "Update <site>" starts an `EDIT` job: the extension opens the listing, clicks its Edit button (only opens the form), fills the changed title/description/price (`site.edit.fields` in `site-*.js`; quantity and photos are left as "your turn"), and the seller saves; `EDITED` marks it synced. Not yet run on the real sites.
- **Overpriced alerts** (`lib/comps/overpriced.ts`, `findOverpriced`, `OverpricedCheck` on Inventory): items whose asking price is 25%+ above the 90-day sold median on file for their title (`comp_sales`, at least 3 sales, best offers left out). One tap sets the sold median everywhere through `repriceItems`.

### Scan to Comp (CompAmp in FlipLedger)

- `/comp` (bottom-bar "Comp" tab, which it shares with `/calculator` via `CompCalcTabs`; also the header scan button): camera barcode scan (`BarcodeDetector` on Android Chrome, ZXing `@zxing/browser` on iPhone) or typed UPC/keywords → `lookupComps` (`lib/comps/`).
- **Live listings:** eBay Browse API `item_summary/search` by `gtin` or `q` with the app token (`getAppToken`, cached per server instance), no seller login, 100 listings per call. eBay's public APIs don't give sold prices (Marketplace Insights needs eBay approval).
- **In the Profit Calculator:** `CompFill` (scan or type, pick the product) puts the eBay estimate into Sale Price and switches fees to eBay.
- **API budget:** Browse is 5,000 calls a day for the whole app by default. Every search goes through `comp_cache` (`lib/comps/cache.ts`, service role only, shared): live results for 2 hours, so a product costs at most one call per 2 hours however many people scan it or refresh it. Tracked products refresh only on tap (no cron).
- **Which product?** (`lib/comps/identify.ts`, from CompAmp's `identify`): typed words like "pokemon upc" cover many products, so Claude groups the live listings into up to 6 distinct products (cached a day per search) and the seller picks one (`CompPick` → "Which one is it?"). Comps are then searched and judged for that exact product. Barcodes skip this: the product is the barcode's first listing title. `tracked_products.product` keeps the pick for refreshes.
- **Sold prices:** `comp_sales`, shared by all users (public market data; read policy for authenticated, writes only through `saveSoldComps` with the service role). Filled by extension 0.8.0+: `COMPS` opens `ebay.com/sch/i.html?_nkw=…&LH_Sold=1&LH_Complete=1&_ipg=240` in a background tab, `extension/comps-ebay.js` reads the cards (parser ported from CompAmp's `collector.js`), and the app saves them. Rows are filed under `queryKey(query)`, where query = `searchPhrase(product)`. Phones see whatever a desktop already read.
- **Stats** (`lib/comps/stats.ts`, from CompAmp's sold research): 30/90-day sold medians (price + shipping, best offers left out), live count and lowest Buy It Now, sell-through = sold30 / (sold30 + live), days of supply. Estimate = sold 30d median, else 90d, else live median. Live count is eBay's `total` for the search scaled by the share the judge kept (not just the 100 read). New vs used/open-box estimates (`newEstimate`/`usedEstimate`) show once there are 3+ prices of each. Profit = estimate − 13.25% eBay fee − $6 label − cost.
- **Tracked products** (`tracked_products`, per user): CompAmp's product tracking with a target cost; refreshed on demand (Browse calls are rate-limited, so no cron yet).
- **AI judge** (`lib/comps/judge.ts`, from CompAmp's `judge`): before the stats, a small Claude model (`AI_MODEL`, forced tool call) keeps only listings that are the exact product (drops cases, lots, parts, empty boxes, other models). The product is the barcode's first live title or the picked product. Verdicts are cached per product + title hash in `comp_judgments` (service role only), so each title is judged once for everyone; spend is logged in `ai_usage` as `comp_judge`. If Claude is unavailable everything counts as kept. `lookupComps` returns `filteredOut`, shown under the estimate. `findOverpriced` uses the same judge.
- Not ported from CompAmp: version/edition pickers inside a product, the human review queue, collector leases and daily background refreshes. CompAmp itself (Lovable project `a7f2033a-…`, comp.emoneydeals.com) still runs separately.

### Emails (Resend)

- `lib/email/`: `sendEmail` posts to Resend with `RESEND_API_KEY`, from `RESEND_FROM` (default `FlipLedger <noreply@mail.emoneydeals.com>`; `mail.emoneydeals.com` is the domain verified in Resend, the bare `emoneydeals.com` is not). Templates are inline-styled and left-aligned.
- Daily cron `/api/cron/daily-emails` (14:00 UTC = 9am ET): on Sundays the weekly recap (`lib/recap.ts`, skipped for quiet weeks), every day the quarterly tax reminder 7 days and 1 day before a due date (skipped when there's nothing to set aside). `email_log` (service role only) makes each send happen once.
- Opt-outs: `settings.email_recap`, `settings.email_tax_reminders`, toggled in Settings, or one-click from the signed link `/api/email/unsubscribe?u&k&s` (HMAC with `CRON_SECRET`; public path in `proxy.ts`; also sent as `List-Unsubscribe`).
- Settings → "Email me this week's recap now" sends a recap immediately (good for checking Resend). `/recap` is the in-app recap screen.
- **Push notifications** (`lib/push/`): web push with VAPID keys derived from `CRON_SECRET` (`vapidKeys`, HMAC → P-256), so no extra env vars; changing `CRON_SECRET` means devices re-subscribe on their next Settings visit. `push_subscriptions` (one row per device, upsert on `endpoint`). Settings → "Notifications on this device" (`PushToggle`) subscribes and sends a test. The Sunday recap pushes alongside the email (`sendRecap`), and `logMileage` pushes "12.4 mi logged, $8.68 write-off." `public/sw.js` handles `push` and `notificationclick`. On iPhone push only works from the Home Screen app.

### AI listing from photos

- `lib/ai/listing.ts` + `aiDraftListing` (`actions/ai.ts`), button "Write it from photos" in the crosslist panel. Calls the Claude Messages API directly (`ANTHROPIC_API_KEY`, model `AI_MODEL`, default `claude-haiku-5-5`) with up to 4 signed photo URLs and a forced tool call so the answer is structured (`listingDraftSchema`). Fills the draft form only; nothing is saved until the seller saves.
- Budget guard: client asked for under $500/month. Small model, 4 photos, 900 max tokens, and a per-user cap of `AI_DAILY_LIMIT` (default 60) calls per 24 hours, counted in `ai_usage` (service role only; also the place to check spend).
- **Background removal** (`lib/bg-remove.ts`): runs in the browser with Transformers.js (`@huggingface/transformers`, loaded only when used) and the Apache-2.0 ORMBG model (`d30social/ormbg-ortweb` fp16, ~90 MB, cached by the browser; fallback `onnx-community/ormbg-ONNX` q8; override with `NEXT_PUBLIC_BG_MODEL`). Don't switch to RMBG (non-commercial license) or `@imgly/background-removal` (AGPL). The wand on each photo in `PhotoPicker` puts the item on white, uploads it as a new file and swaps it in.

### Smart Offers

- Rules in `smart_offer_rules` (Settings, Cross-Lister): start discount, max discount, floor = cost × (1 + margin), minimum listing age, how often. `offerPrice` (`lib/offers.ts`, tested) deepens the discount 1 point per week past the minimum age, never below the floor, and skips anything under 5% / $1 off.
- `runSmartOffers` (`lib/marketplaces/ebay/offers.ts`) runs from the daily `sync-sales` cron after each account's sale sync: Negotiation API `find_eligible_items` → for listings FlipLedger knows (so cost is known) `send_offer_to_interested_buyers`, 2-day offers, no counter-offers. Each offer is logged in `smart_offers`; after 3 days it's marked `sold` (item sold within 3 days at or under offer + $1) or `expired`.
- **Poshmark and Mercari** are assisted, never automatic (no API; their terms ban bots): `getAssistedOffers` (`lib/offers-assisted.ts`, tested) lists active listings due an offer under the same rules, and Settings shows them. With extension 0.9.0+ "Fill offer" starts an `OFFER` job: the extension opens the listing, clicks its offer-to-likers button (opens the form only) and fills the price (`site.offer` in `site-*.js`); the seller sends it and clicks "I sent it" → `OFFERED` → `logAssistedOffer`. `smart_offers.marketplace` tells them apart; the eBay cron's frequency check counts only eBay rows. Selectors not yet run on the real sites.

### Leaderboard and win cards

- `/leaderboard`: opt-in only (`leaderboard_profiles`, default off, name = initials or a nickname up to 24 chars). Monthly boards for profit, items sold and miles (`lib/leaderboard.ts`, UTC months), last month's #1 per board shown as champion. Other sellers' rows are read with the service role in `boardRows` and only names and totals reach the browser.
- Win card: `/api/win-card` (signed-in seller's own numbers, `?last=1` for last month) renders a 1080×1080 PNG with `next/og` (`lib/win-card.tsx`).
- "Post to eMoney Discord wins" (`postWinToDiscord`) uploads the card through `DISCORD_WINS_WEBHOOK_URL` (hidden when unset), once per seller per month (guarded by `email_log` kind `win-post`).

### Cross-listing

- **Registry:** `lib/marketplaces/registry.ts` lists each marketplace's mode (`api` / `assisted`), sell URL, fee preset and photo limit.
- **Engine:** `lib/crosslist/engine.ts` (pure, tested with a fake store). When an item sells anywhere it ends API listings and marks assisted ones `delist_pending`. A partial sale only updates quantity. Failed ends become `error` with a friendly `last_error`. It's wired to Supabase in `lib/crosslist/store.ts`.
- **eBay:** `lib/marketplaces/ebay/`.
  - **One eBay developer app** (the client's), and **each user connects their own seller account** via OAuth.
  - Tokens are AES-GCM encrypted (`lib/crypto.ts`, `TOKEN_ENCRYPTION_KEY`) in `marketplace_accounts`. That table has no RLS policies; clients read the `marketplace_connections` view.
  - Publishing: Inventory API `inventory_item` → `offer` → `publish`. SKU = item id.
  - Sales: Fulfillment `getOrders`, synced on app open (`AutoSync`, at most every 5 minutes), via "Sync now", and by a daily cron at `/api/cron/sync-sales`. `marketplace_sales` makes it idempotent.
  - A line whose SKU isn't one of the seller's item ids (listed straight on eBay, or the seller's own SKU) becomes a new sold item with `cost_unknown = true` (`ebaySoldItem` in `lib/sales/untracked.ts`): title, quantity, price, buyer shipping and eBay's real fee from the order, no ad fee. Only orders since the account connected are read, so older sales don't come in.
  - `/api/marketplaces/ebay/account-deletion` is required by eBay for production keys.
  - **Business policies** (shipping, payment, returns) are required to list. Settings can create starter ones through the Account API (`createEbayPolicies` → `createPolicies`, `sell.account` scope) named "FlipLedger shipping/payment/returns", or link to eBay's page (`businessPoliciesUrl`). They're normal policies the seller can edit on eBay. USPS Ground Advantage's service code is `USPSParcel`.
  - **Promoted Listings** (cost per sale, `lib/marketplaces/ebay/promote.ts`, `sell.marketing` scope): each seller gets one manual campaign named "FlipLedger promoted listings" (id saved in `settings.campaignId`), and each listing is added by listing ID at its own rate (`bulk_create_ads_by_listing_id`, falling back to `bulk_update_ads_bid_by_listing_id` if it's already in there). Rates are 2.0–100.0 with one decimal (`normalizeAdRate`). The default (`settings.promote`) is set in Settings, and the List on eBay form and live eBay listings can override it. The rate is saved in `marketplace_listings.ad_rate`. A failed promotion never undoes the listing; it comes back as `promoteError`. Sale sync adds an *estimated* ad fee (`adFeeCents`: rate × item price plus shipping) because the order's `totalMarketplaceFee` doesn't include it. eBay only charges when the sale came through the ad, and it also counts tax.
- **Importing existing listings** (Settings → Import listings): Poshmark is read on the server from the public closet (`lib/import/poshmark.ts`, from the page's `__INITIAL_STATE__`, 48 a page via `max_id`); Mercari by the extension (servers get Cloudflare's challenge). `lib/import/plan.ts` skips listings already tracked, adds a listing to an inventory item with the same title (how one item gets both its Posh and Mercari listings), and creates the rest as items with `cost_unknown = true` (shown as "Add cost" / Needs Cost until the seller enters a cost). The client sends candidates in batches of 50 because server actions cap bodies at 1MB. Closets are ordered by last share, so a listing shared mid-read can be missed; importing again picks it up.
- **Photos to eBay** go as short signed links, `/api/p/<exp>/<sig>/<path>` (`lib/photo-links.ts`), because eBay rejects picture URLs over 500 characters (3,975 total).
- **Chrome extension:** `extension/` (MV3, plain JS, excluded from tsconfig). It auto-fills Facebook Marketplace, Poshmark and Mercari, including a category guessed from the title (`guessCategory`/`categoryPath` in `shared.js`, unit-tested; per-site menu texts are best guesses until run on the real sites). The user finishes what it can't and clicks Publish, unless they turned on auto-publish (per computer, like auto-delist; flags in `lib/extension.ts`). `runner.js` holds the flow and each site is a config in `site-*.js` (fields found by visible label or placeholder). The app talks to it via `window.postMessage` (`lib/extension.ts`, `components/crosslist/extension-bridge.tsx`). `registry.ts` marks which sites it supports (`extension`, `saleCheck`). None of the sites' selectors have been run on the real sites yet. Chrome Web Store: public, linked in the app via `EXTENSION_STORE_URL` (`lib/marketplaces/registry.ts`); the seller guide is the public `/extension` page. `npm run pack:extension` builds `dist/flipledger-extension-<version>.zip` (drops tests, docs and the localhost entries from the manifest); `extension/STORE.md` has the listing text, permission justifications and privacy answers, and the store links to the public `/privacy` page. Bump the manifest version for every upload. Request only permissions the code uses: the store rejected 0.6.0 for an unused `tabs` (only needed to read a tab's URL or title; creating, messaging and closing tabs work without it).
- **Auto-delist:** opt-in per computer (`localStorage`, Settings), off by default. `AutoSync` sends up to 3 `delist_pending` listings per tick, each tried once per page load. `runner.js` `autoDelist` only clicks on a page whose path contains the listing's ID (`FL.listingId`); any surprise reports an error and leaves the listing on the delist list. Buttons are per-site in `site-*.js` (`delist.auto`). Not yet run on the real sites.
- **Poshmark/Mercari sales:** read from each listing's public page by `saleStatus` (`lib/marketplaces/sale-status.ts`; the same rules are in `extension/shared.js`, and a test runs both on the same pages). Never use schema.org availability for this: a sold Poshmark listing says `OutOfStock` (same as not for sale) and a sold Mercari item says `InStock`. Read the listing's own field, matched by listing ID, because pages also carry similar items: Poshmark `inventory.status` (`sold_out`), Mercari item `status` (`trading`).
  - **Poshmark** runs on the server (`lib/marketplaces/assisted-sync.ts`) from `syncSales` on app open and from the daily cron, so it works on phones. `checked_at` throttles it. It only ever fetches `poshmark.com` (`poshmarkUrl`), because links are typed by users. A `poshmark check:` log line counts blocked pages.
  - **Mercari** blocks servers with a Cloudflare challenge; don't try to get around it. The extension checks it from the seller's browser (`AutoSync`, at most every 5 minutes, desktop only) and also checks Poshmark as a fallback.
  - `lib/crosslist/assisted-sales.ts` records the sale (one unit, fee from the marketplace's preset, price = page price) and confirms `delist_pending` listings that are gone. Idempotent via `marketplace_sales` (`external_line_id` = listing id). Needs the listing's URL.
  - **Untracked Mercari sales** (Settings → "Bring in sales FlipLedger missed", Cross-Lister only, extension 0.7.0+): the extension opens the seller's Mercari sold lists (`/mypage/listings/in_progress/` then `/complete/`, best guesses), collects item or transaction links, reads each item page (`FL.mercariSoldItem`) and the app records the ones that aren't tracked listings as sold items with `cost_unknown = true` (`planUntrackedSales`, `recordSales` in `actions/import.ts`). `marketplace_sales.external_line_id` is Mercari's own `m…` ID here (not a listing row id). The sold date is read from the page when there's a field for it, else today. Only reads; never clicks. Not yet run on the real site.
- **Unknown cost:** `items.cost_unknown` marks imported items and sales of untracked items. The item sheet shows an "Add cost" box (`setItemCost`, $0 allowed), cards and the sheet say "before cost" instead of a margin, Inventory has a Needs Cost chip (`/inventory?filter=cost`), and the dashboard counts them (`Summary.unknownCostSales`) and keeps them out of Best Performing Sale. Partial sales copy the flag.

### Marketplace strategy (researched Oct 2026)

| Site | Approach | Why |
| --- | --- | --- |
| eBay | Official API | Public Sell APIs |
| Facebook | Chrome extension (desktop); copy kit on phones | No listing API for third-party tools |
| Depop | **Partner API, once approved** (email developers@depop.com) | Private Selling API with OAuth and sale webhooks. Don't automate via the extension: Depop's terms ban it |
| Mercari, Poshmark | Chrome extension (desktop), at the user's risk; copy kit on phones | No API; terms ban automation, but competitors do the same and bans target bots. The extension only fills forms the seller submits. Never build share/follow/relist bots |
| Vinted | Copy kit only | API is EU/UK Pro only; users have been banned for automation |
| Etsy | Skipped | Client doesn't need it |

A Capacitor app could put the same fill-in scripts in an in-app web view for phones; that's been discussed but not built.

## eBay gotchas (each one bit us)

- **`Accept-Language`:** Node `fetch` sends `Accept-Language: *` by default and eBay rejects it. `ebayFetch` sets `en-US`, so keep that on any new eBay call.
- **Condition:** allowed conditions differ by category. Load them with the Metadata API `getItemConditionPolicies` and send a condition ID that category allows (`EBAY_CONDITION_ENUM`, matching eBay's official table). Never hard-code one condition.
- **Item specifics:** required ones must be filled; the List button stays disabled until they are.
- **Keys must match the environment:** sandbox and production keys must never be mixed. `EBAY_ENV`, `EBAY_CLIENT_ID` (`SBX` vs `PRD`), `EBAY_CLIENT_SECRET` and `EBAY_RUNAME` must all come from the same keyset. Each keyset has its own RuName, and a mismatch shows up as `unauthorized_client` or a vague `temporarily_unavailable`.
- **Sandbox logins:** the sandbox only accepts sandbox test users, not real eBay accounts.
- **Seller setup:** "need some additional information to create a seller's account" means the user must finish seller setup on ebay.com. It isn't a field in our form.
- **Adding OAuth scopes:** a refresh may only ask for scopes the seller already granted, or eBay rejects it and the connection looks expired. Granted scopes are saved in `marketplace_accounts.scopes` (null means `LEGACY_EBAY_SCOPES`), refreshes use them, and features that need a new scope check for it (e.g. `canPromote`) and ask the seller to reconnect. Reconnecting the same eBay account keeps its settings (callback route).

## Data and deploys

- **Migrations:** files in `supabase/migrations/` run on every production deploy (`vercel.json` buildCommand → `scripts/migrate.mjs`, using `POSTGRES_URL_NON_POOLING`). Preview deploys skip it, and a failed migration fails the deploy. **Never edit an applied migration; add a new numbered file.** Production's `0001` was originally applied by hand and is recorded in `supabase_migrations.schema_migrations`.
- **Auth email templates:** `supabase/templates/*.html` only reach local Supabase through `config.toml`. Production uses whatever is pasted into Supabase → Authentication → Email Templates. Those must be our `token_hash` links: Supabase's default `{{ .ConfirmationURL }}` is a PKCE link that only works in the browser that signed up. `/auth/callback` sends those failures to `/login?error=browser`. `token_hash` links go from `/auth/callback` to `/auth/confirm`, which verifies only when the person taps Continue (a POST); verifying on GET let mail scanners and link previews use up the one-time token first.
- **Cron:** daily, because Vercel Hobby doesn't allow more often. Use `*/10 * * * *` on Pro.
- **Env vars** (full list in `.env.example`):
  - Supabase: `SUPABASE_SERVICE_ROLE_KEY` (from the integration)
  - Generated by us: `TOKEN_ENCRYPTION_KEY` (never change it once set), `CRON_SECRET`
  - Whop: `WHOP_CLIENT_ID`, `WHOP_API_KEY`, `WHOP_CROSSLIST_PRODUCT_IDS`, `WHOP_CROSSLIST_CHECKOUT_URL` (monthly), `WHOP_CROSSLIST_ANNUAL_URL`, `WHOP_CROSSLIST_ANNUAL_PLAN_ID`, `WHOP_SAVE_PROMO_CODE` (optional), `FLIPLEDGER_FREE_EMAILS` (`ALLOW_EMAIL_LOGIN` local only). All set in production since Nov 13 2026, so Whop sign-in and the paywall are live.
  - `CANONICAL_HOST` (e.g. `profit.emoneydeals.com`): when set, `proxy.ts` redirects production `*.vercel.app` visits there (`lib/canonical-host.ts`), except `/api` (but the eBay OAuth callback does move, since the eBay RuName may still point at the old host and the session cookie lives on the new one). Set to `profit.emoneydeals.com` in production (live since Nov 2026).
  - eBay: `EBAY_ENV`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RUNAME`, `EBAY_VERIFICATION_TOKEN`, `EBAY_DELETION_ENDPOINT`
  - Vercel marks secrets "Sensitive"; `vercel env pull` can't read those.

## Git workflow

- **Start every session from the latest `main`:** run `git fetch origin` first and branch from `origin/main`. This checkout is often many commits behind.
- **Work in your own git worktree for every task**, never in the shared checkout or on a branch another session has checked out, so changes don't get mixed up: `git worktree add ../profit-tracking-app-<task> -b <branch> origin/main`. Other Claude sessions often share this folder, and uncommitted changes there are usually someone else's work in progress, so leave them alone. Symlink `node_modules` into the worktree; Turbopack builds fail through the symlink, so rely on the Vercel preview build (or run `npm ci` in the worktree to use `next dev`).
- Work on a branch, open a PR to `main`, and let the user merge. Auto mode won't merge unreviewed PRs.
- **Before pushing more commits to a PR branch, check the PR isn't already merged.** Commits pushed after a merge never reach `main`; that happened once with PR #7.
- **Run tests before `git push`**, chained with `&&`, never `;`.
- `feature/google-signin` holds a finished Google sign-in. Keep it off `main` until the client asks.
