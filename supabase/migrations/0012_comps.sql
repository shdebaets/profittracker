-- Scan to Comp / CompAmp in FlipLedger.
-- comp_sales: eBay sold listings read from public sold-search pages by sellers' extensions.
-- It's public market data, shared by everyone so a phone scan can use what a desktop collected.
create table public.comp_sales (
  query_key text not null,
  external_id text not null,
  title text not null,
  price_cents integer not null check (price_cents > 0),
  shipping_cents integer,
  sold_on date not null,
  best_offer boolean not null default false,
  condition text,
  collected_at timestamptz not null default now(),
  primary key (query_key, external_id)
);
create index comp_sales_query_sold_idx on public.comp_sales (query_key, sold_on desc);
alter table public.comp_sales enable row level security;
create policy "read comps" on public.comp_sales for select to authenticated using (true);
-- Writes go through a server action with the service role, after validation.

-- Products a seller watches (CompAmp's tracked products), with the latest numbers.
create table public.tracked_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  query text not null,
  gtin text,
  title text,
  image_url text,
  target_cost_cents integer,
  stats jsonb,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, query)
);
alter table public.tracked_products enable row level security;
create policy "own rows" on public.tracked_products for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
