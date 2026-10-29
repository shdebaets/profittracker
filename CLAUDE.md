@AGENTS.md

# FlipLedger

Reseller profit tracker plus cross-lister. It's a PWA for many unrelated resellers: each user signs up and only ever sees their own data. The client is Nick (repo `shdebaets/profittracker`). Production runs at https://profittracker-iye3.vercel.app on Vercel, with Supabase via the Vercel Marketplace integration.

## Keep this file current

Update CLAUDE.md in the same PR whenever you change something durable: architecture, a convention, a command, an env var, a marketplace decision, or a gotcha you hit. Remove anything that's no longer true. A Stop hook (`.claude/hooks/claude-md-reminder.sh`) prompts this when code changed without CLAUDE.md changing. If nothing durable changed, ignore it.

## Stack

- **Next.js 16.3** (App Router) and React 19. APIs differ from older Next; read `node_modules/next/dist/docs/` before writing routes, proxy or error code (see AGENTS.md).
  - `proxy.ts` replaces `middleware.ts`.
  - `error.tsx` and `global-error.tsx` get `retry()`.
  - Route handlers are typed with `RouteContext<"/path/[param]">`.
  - `route.ts` files may only export HTTP handlers and route config; put helpers in `lib/`.
- **Supabase:** Postgres with row-level security (RLS) on every table, no ORM, `@supabase/ssr`. Plus Storage (private `item-photos` bucket) and Auth (email/password and magic link).
- **UI:** Tailwind v4, shadcn plus `@base-ui/react`, lucide icons, sonner toasts. Mobile-first: test at 375px.
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
- **Photos to eBay** go as short signed links, `/api/p/<exp>/<sig>/<path>` (`lib/photo-links.ts`), because eBay rejects picture URLs over 500 characters (3,975 total).
- **Chrome extension:** `extension/` (MV3, plain JS, excluded from tsconfig). It auto-fills Facebook Marketplace, Poshmark and Mercari; the user finishes the fields it can't (category etc.) and clicks Publish. `runner.js` holds the flow and each site is a config in `site-*.js` (fields found by visible label or placeholder). The app talks to it via `window.postMessage` (`lib/extension.ts`, `components/crosslist/extension-bridge.tsx`). `registry.ts` marks which sites it supports (`extension`, `saleCheck`). None of the sites' selectors have been run on the real sites yet.
- **Poshmark/Mercari sales:** the extension fetches each live listing's public page (no cookies) and reads schema.org `availability` (`FL.saleStatus`). `AutoSync` runs it at most every 5 minutes while the app is open in desktop Chrome; `applyExtensionSaleChecks` → `lib/crosslist/assisted-sales.ts` records the sale (one unit, fee from the marketplace's preset, price = listing price) and confirms `delist_pending` listings that are gone. Idempotent via `marketplace_sales` (`external_line_id` = listing id). Needs the listing's URL.

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

## Data and deploys

- **Migrations:** files in `supabase/migrations/` run on every production deploy (`vercel.json` buildCommand → `scripts/migrate.mjs`, using `POSTGRES_URL_NON_POOLING`). Preview deploys skip it, and a failed migration fails the deploy. **Never edit an applied migration; add a new numbered file.** Production's `0001` was originally applied by hand and is recorded in `supabase_migrations.schema_migrations`.
- **Cron:** daily, because Vercel Hobby doesn't allow more often. Use `*/10 * * * *` on Pro.
- **Env vars** (full list in `.env.example`):
  - Supabase: `SUPABASE_SERVICE_ROLE_KEY` (from the integration)
  - Generated by us: `TOKEN_ENCRYPTION_KEY` (never change it once set), `CRON_SECRET`
  - eBay: `EBAY_ENV`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RUNAME`, `EBAY_VERIFICATION_TOKEN`, `EBAY_DELETION_ENDPOINT`
  - Vercel marks secrets "Sensitive"; `vercel env pull` can't read those.

## Git workflow

- **Start every session from the latest `main`:** run `git fetch origin` first and branch from `origin/main`. This checkout is often many commits behind.
- **Work in your own git worktree for every task**, never in the shared checkout or on a branch another session has checked out, so changes don't get mixed up: `git worktree add ../profit-tracking-app-<task> -b <branch> origin/main`. Other Claude sessions often share this folder, and uncommitted changes there are usually someone else's work in progress, so leave them alone. Symlink `node_modules` into the worktree; Turbopack builds fail through the symlink, so rely on the Vercel preview build (or run `npm ci` in the worktree to use `next dev`).
- Work on a branch, open a PR to `main`, and let the user merge. Auto mode won't merge unreviewed PRs.
- **Before pushing more commits to a PR branch, check the PR isn't already merged.** Commits pushed after a merge never reach `main`; that happened once with PR #7.
- **Run tests before `git push`**, chained with `&&`, never `;`.
- `feature/google-signin` holds a finished Google sign-in. Keep it off `main` until the client asks.
