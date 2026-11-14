-- Lots (hauls): a receipt photo and how the cost was split.
alter table public.hauls
  add column receipt_path text,
  add column split_mode text not null default 'value' check (split_mode in ('even', 'value'));

-- Stale inventory alerts: how many days before an unsold item counts as stale.
alter table public.settings
  add column stale_days integer not null default 60 check (stale_days in (30, 45, 60, 90, 120));

-- Edit once, update everywhere: per-listing sync state for price/title/quantity changes.
-- synced: the marketplace matches FlipLedger. pending: a change still has to reach the
-- marketplace (assisted sites, done by the extension or by hand). failed: the API refused it.
alter table public.marketplace_listings
  add column sync_status text not null default 'synced' check (sync_status in ('synced', 'pending', 'failed')),
  add column sync_error text,
  add column pending_changes jsonb;
