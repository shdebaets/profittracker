-- Scan to Comp: cache eBay Browse searches and the AI's "which product?" answers so repeat
-- lookups and tracked-product refreshes don't spend eBay API calls or AI tokens. Public market
-- data, shared by everyone; only the server (service role) reads and writes it.
create table public.comp_cache (
  key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.comp_cache enable row level security;

-- The exact product a tracked search was narrowed to (e.g. "Pokemon 30th Anniversary Ultra
-- Premium Collection"), so refreshes judge listings against it, not the loose search words.
alter table public.tracked_products add column if not exists product text;
