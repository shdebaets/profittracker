-- Smart Offers (eBay only): automatic offers to watchers, within the seller's rules.
create table public.smart_offer_rules (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  enabled boolean not null default false,
  discount_pct integer not null default 10 check (discount_pct between 5 and 50),
  max_discount_pct integer not null default 20 check (max_discount_pct between 5 and 60),
  floor_margin_pct integer not null default 20 check (floor_margin_pct between 0 and 300),
  min_age_days integer not null default 7 check (min_age_days between 0 and 365),
  every_days integer not null default 3 check (every_days between 1 and 14),
  updated_at timestamptz not null default now()
);
alter table public.smart_offer_rules enable row level security;
create policy "own rows" on public.smart_offer_rules for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Every offer sent, and whether the item later sold at or under it.
create table public.smart_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  item_id uuid references public.items on delete set null,
  listing_id text not null,
  title text,
  list_price_cents integer not null,
  offer_cents integer not null,
  sent_at timestamptz not null default now(),
  outcome text check (outcome in ('sold', 'expired')),
  error text
);
create index smart_offers_user_sent_idx on public.smart_offers (user_id, sent_at desc);
alter table public.smart_offers enable row level security;
create policy "own rows read" on public.smart_offers for select to authenticated using (user_id = (select auth.uid()));
