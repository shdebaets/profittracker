-- Tracker row 81: remember when eBay refused a token refresh, so Settings and the dashboard
-- can say "Reconnect eBay" before the seller presses Sync. Cleared on a successful refresh
-- or a reconnect.
alter table public.marketplace_accounts add column reconnect_needed_at timestamptz;

-- Expose it to the seller. New columns go last.
create or replace view public.marketplace_connections with (security_invoker = false) as
  select id, user_id, marketplace, external_username, settings, last_synced_at, created_at, scopes, reconnect_needed_at
  from public.marketplace_accounts
  where user_id = (select auth.uid());
