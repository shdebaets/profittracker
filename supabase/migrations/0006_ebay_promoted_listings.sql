-- eBay Promoted Listings (cost per sale).

-- OAuth scopes the seller granted. null = connected before we asked for sell.marketing,
-- so refreshes must keep asking for the old set until they reconnect.
alter table public.marketplace_accounts add column scopes text[];

-- Ad rate (percent of the sale) the listing is promoted at; null = not promoted.
alter table public.marketplace_listings
  add column ad_rate numeric(4, 1) check (ad_rate is null or (ad_rate >= 2 and ad_rate <= 100));

-- Expose scopes so the app can tell who needs to reconnect to promote. New columns go last.
create or replace view public.marketplace_connections with (security_invoker = false) as
  select id, user_id, marketplace, external_username, settings, last_synced_at, created_at, scopes
  from public.marketplace_accounts
  where user_id = (select auth.uid());
