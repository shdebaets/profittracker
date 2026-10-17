# FlipLedger — Reseller Profit Tracker

Installable web app (PWA) for resellers. Users log inventory and sales, and the app tracks realized net profit, margin, inventory value, return windows, and Schedule C overhead (expenses, mileage, subscriptions). Data syncs across devices through Supabase.

**Stack:** Next.js 16 (App Router) · Tailwind v4 + shadcn/ui · Supabase (Postgres + Auth + RLS) · Vitest

## Features (v1)

- **Dashboard:** net profit, margin, COG vs profit bar, revenue, inventory value, average profit per sale, and best sale. Filter by All Time, Today, This Week, or This Month. Also shows profit after overhead.
- **Add entry (+):** record a sale or add inventory. Includes fee presets (Cash, Card 2.9%+30¢, Mercari/Depop 10%, eBay 13.25%, Poshmark 15%, custom), buyer-paid shipping, label cost, and a live net-profit estimate.
- **Log Haul:** enter one receipt total and it splits across items, weighted by estimated value (or evenly per unit).
- **Inventory:** All/Sales/Stock tabs, time filters, search, and a return-window countdown with **Mark Returned**. **Mark Sold** handles partial lots, e.g. selling 2 of 5 splits the row. Exports to CSV.
- **Calculator:** what-if profit and break-even price. "Log sale" prefills the add sheet.
- **Expenses:** ledger with categories, manual mileage log at a configurable IRS rate, monthly subscriptions (pause or resume), and CSV export.
- **Settings:** mileage rate, default return window, sign out.
- **PWA:** installable, and the app shell and offline page are cached. Data still needs a connection.

## Local development

Requires Node 22+ and Docker.

```bash
npm install
npx supabase start                  # local Postgres + Auth on :54321, applies supabase/migrations
npx supabase status -o env          # copy API_URL / ANON_KEY into .env.local (see .env.example)
npm run dev                          # http://localhost:3000
```

**Testing on your phone (same Wi-Fi):** run `npm run dev -- -H 0.0.0.0`, then open `http://<your-computer's-IP>:3000` on the phone (`ipconfig getifaddr en0` on a Mac). Leave `NEXT_PUBLIC_SUPABASE_URL` as `127.0.0.1`: the browser never talks to Supabase directly, because sign-in and all data calls go through the Next.js server. `next.config.ts` allows `192.168.*` / `10.*` hosts in dev.

Local auth auto-confirms email sign-ups. Magic-link emails go to Mailpit at http://127.0.0.1:54324.

```bash
npm test        # profit math unit tests
npm run lint
npm run build
```

## Deploying

1. Create a Supabase project, either through the **Vercel Marketplace → Supabase** integration (it sets the env vars for you) or on supabase.com.
2. Apply the schema: `npx supabase link --project-ref <ref> && npx supabase db push`.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) in Vercel.
4. In Supabase → Auth → URL Configuration, set the Site URL to your domain and add `https://<domain>/auth/callback` as a redirect URL.
5. Deploy with `vercel deploy`. On a phone, open the site and use Share → **Add to Home Screen**.

## Money math

All amounts are stored as integer cents. See `lib/profit.ts`:

```
revenue = sale_price × qty + buyer_shipping
fees    = round(revenue × fee_pct) + fee_fixed
net     = revenue − fees − label_cost − unit_cost × qty
```

## Not in v1 (candidates for later)

Receipt OCR, photo item ID, eBay sold-comps lookup, GPS auto mileage tracking, barcode scanning, and offline data entry.

## Cross-listing setup (eBay)

eBay is listed and delisted automatically. Mercari, Facebook Marketplace, Depop, Vinted and Poshmark have no public API, so they get a copy-and-paste listing kit plus "delist this" reminders when an item sells elsewhere.

1. Create an account at developer.ebay.com and generate a **Sandbox** keyset. Set `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`, and leave `EBAY_ENV=sandbox`.
2. Under *User Tokens*, create a RuName. Set its accept URL to `https://<your-app>/api/marketplaces/ebay/callback` and put the RuName in `EBAY_RUNAME`. eBay needs an https URL, so test against a deployed preview or an https tunnel, not plain localhost.
3. Set `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_KEY` (any long random string) and `CRON_SECRET`.
4. Apply the migrations: `0002_item_photos.sql` (creates the `item-photos` bucket) and `0003_crosslisting.sql`.
5. In the app, open Settings → Marketplaces → Connect eBay. Pick shipping, payment and return policies, and enter a ship-from ZIP.
6. Before you can get **production** keys:
   - deploy the app
   - register `https://<your-app>/api/marketplaces/ebay/account-deletion` under *Alerts & Notifications → Marketplace account deletion*, with `EBAY_VERIFICATION_TOKEN` (and `EBAY_DELETION_ENDPOINT` set to that exact URL)
   - then switch to `EBAY_ENV=production` with the production keyset

**Sale sync:**
- eBay sales are pulled when the app opens (at most every 5 minutes), from *Sync sales now* in Settings, and by a daily Vercel Cron (`vercel.json`).
- On Vercel Pro, change the schedule to `*/10 * * * *` for near-real-time delisting.
