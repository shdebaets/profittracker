-- Tracked products are refreshed by the daily cron and push an alert when the sold median falls
-- under the target buy price or moves more than 15%. alert_median_cents is the median the next move
-- is measured from (set on the first check and after each alert).
alter table public.tracked_products
  add column if not exists alert_median_cents integer,
  add column if not exists alerted_at timestamptz;

create index if not exists tracked_products_checked_idx on public.tracked_products (checked_at nulls first);

-- Snapshots also keep the sold side, so a tracked product's sold median has a history too.
alter table public.comp_snapshots
  add column if not exists sold_median_cents integer,
  add column if not exists sold30 integer;
