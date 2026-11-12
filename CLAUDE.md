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
- **Supabase:** Postgres with row-level security (RLS) on every table, no ORM, `@supabase/ssr`. Plus Storage (private `item-photos` bucket) and Auth (sessions; people sign in with Whop, see "Login and paid access").
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
- **Login and paid access** (`lib/whop/`):
  - **Sign in with Whop** only in production: `/auth/whop/start` → Whop OAuth (PKCE, state in a cookie) → `/auth/whop/callback`. The callback reads Whop `userinfo`, finds the Supabase user (`whop_links.whop_user_id`, else the *verified* Whop email, which is how email-login accounts kept their data, else a new user), and mints a normal Supabase session with `admin.generateLink({ type: "magiclink" })` + `verifyOtp`. Whop tokens aren't stored.
  - **Paywall:** `requireUser()` redirects to `/subscribe` unless `hasPaidAccess()`. Use `getSessionUser()` only on pages a non-paying user must reach. Access = email in `FLIPLEDGER_FREE_EMAILS`, or Whop `checkAccess` says yes (customer or admin) for any of `WHOP_PRODUCT_IDS`. The answer is cached 10 minutes in `whop_links` (service-role only, no RLS policies, so users can't grant themselves access); if Whop errors, the last answer stands.
  - **Kill switches:** empty `WHOP_PRODUCT_IDS` = no paywall. Empty `WHOP_CLIENT_ID` = email login comes back. `ALLOW_EMAIL_LOGIN=1` shows the email form for local QA.
  - Machine routes (cron, eBay deletion, `/api/p`) don't check access; the cron still syncs lapsed users.
  - If a buyer's Whop email differs from their old FlipLedger email they get a new empty account; fix by pointing `whop_links.user_id` at the old user.
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
- **Admin client:** `lib/supabase/admin.ts` uses the service role and bypasses RLS. It's only for cron, webhooks, the photo-link route and `marketplace_accounts` tokens. Always scope by user yourself.

### Cross-listing

- **Registry:** `lib/marketplaces/registry.ts` lists each marketplace's mode (`api` / `assisted`), sell URL, fee preset and photo limit.
- **Engine:** `lib/crosslist/engine.ts` (pure, tested with a fake store). When an item sells anywhere it ends API listings and marks assisted ones `delist_pending`. A partial sale only updates quantity. Failed ends become `error` with a friendly `last_error`. It's wired to Supabase in `lib/crosslist/store.ts`.
- **eBay:** `lib/marketplaces/ebay/`.
  - **One eBay developer app** (the client's), and **each user connects their own seller account** via OAuth.
  - Tokens are AES-GCM encrypted (`lib/crypto.ts`, `TOKEN_ENCRYPTION_KEY`) in `marketplace_accounts`. That table has no RLS policies; clients read the `marketplace_connections` view.
  - Publishing: Inventory API `inventory_item` → `offer` → `publish`. SKU = item id.
  - Sales: Fulfillment `getOrders`, synced on app open (`AutoSync`, at most every 5 minutes), via "Sync now", and by a daily cron at `/api/cron/sync-sales`. `marketplace_sales` makes it idempotent.
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
  - Whop: `WHOP_CLIENT_ID`, `WHOP_API_KEY`, `WHOP_PRODUCT_IDS`, `WHOP_CHECKOUT_URL`, `FLIPLEDGER_FREE_EMAILS` (`ALLOW_EMAIL_LOGIN` local only)
  - `CANONICAL_HOST` (e.g. `profit.emoneydeals.com`): when set, `proxy.ts` redirects production `*.vercel.app` visits there (`lib/canonical-host.ts`), except `/api`. Leave it unset until the domain resolves.
  - eBay: `EBAY_ENV`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RUNAME`, `EBAY_VERIFICATION_TOKEN`, `EBAY_DELETION_ENDPOINT`
  - Vercel marks secrets "Sensitive"; `vercel env pull` can't read those.

## Git workflow

- **Start every session from the latest `main`:** run `git fetch origin` first and branch from `origin/main`. This checkout is often many commits behind.
- **Work in your own git worktree for every task**, never in the shared checkout or on a branch another session has checked out, so changes don't get mixed up: `git worktree add ../profit-tracking-app-<task> -b <branch> origin/main`. Other Claude sessions often share this folder, and uncommitted changes there are usually someone else's work in progress, so leave them alone. Symlink `node_modules` into the worktree; Turbopack builds fail through the symlink, so rely on the Vercel preview build (or run `npm ci` in the worktree to use `next dev`).
- Work on a branch, open a PR to `main`, and let the user merge. Auto mode won't merge unreviewed PRs.
- **Before pushing more commits to a PR branch, check the PR isn't already merged.** Commits pushed after a merge never reach `main`; that happened once with PR #7.
- **Run tests before `git push`**, chained with `&&`, never `;`.
- `feature/google-signin` holds a finished Google sign-in. Keep it off `main` until the client asks.
