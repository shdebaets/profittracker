-- Scan to Comp history: a snapshot of the live market for a product each time it's looked up
-- (at most one per 2 hours), so the comp screen can chart live listings and lowest price over
-- time. Sold history comes from comp_sales. Public market data, shared; server writes only.
create table public.comp_snapshots (
  query_key text not null,
  taken_at timestamptz not null default now(),
  live_count integer not null,
  lowest_cents integer,
  median_cents integer,
  primary key (query_key, taken_at)
);
alter table public.comp_snapshots enable row level security;
create policy "signed-in users read comp snapshots" on public.comp_snapshots for select to authenticated using (true);
