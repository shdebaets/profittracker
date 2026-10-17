-- Cross-listing: one item, many marketplace listings. When it sells on one, the rest come down.

-- Listing details shared by every marketplace.
alter table public.items
  add column description text,
  add column condition text check (condition in ('new_with_tags', 'new', 'like_new', 'good', 'fair')),
  add column brand text,
  add column size text,
  add column list_price_cents integer check (list_price_cents >= 0);

-- Connected marketplace accounts (eBay today). Token columns are only ever read or
-- written with the service-role key, so clients get the safe columns through a view.
create table public.marketplace_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  marketplace text not null check (marketplace in ('ebay', 'etsy')),
  external_user_id text,
  external_username text,
  access_token_enc text not null,
  refresh_token_enc text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  settings jsonb not null default '{}', -- eBay: policy ids, merchant location key
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, marketplace)
);
alter table public.marketplace_accounts enable row level security;
-- No policies: authenticated users cannot touch this table directly.

create view public.marketplace_connections with (security_invoker = false) as
  select id, user_id, marketplace, external_username, settings, last_synced_at, created_at
  from public.marketplace_accounts
  where user_id = (select auth.uid());
revoke all on public.marketplace_connections from anon;
grant select on public.marketplace_connections to authenticated;

create table public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  item_id uuid not null references public.items on delete cascade,
  marketplace text not null check (marketplace in ('ebay', 'mercari', 'facebook', 'depop', 'vinted', 'poshmark', 'etsy')),
  status text not null default 'active'
    check (status in ('draft', 'active', 'delist_pending', 'delisted', 'sold', 'error')),
  external_id text,  -- eBay listing id
  offer_id text,     -- eBay offer id (needed to withdraw)
  external_url text,
  price_cents integer check (price_cents >= 0),
  last_error text,
  listed_at timestamptz,
  delisted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, marketplace)
);
create index marketplace_listings_user_status_idx on public.marketplace_listings (user_id, status);
create trigger marketplace_listings_touch before update on public.marketplace_listings
  for each row execute function public.touch_updated_at();

alter table public.marketplace_listings enable row level security;
create policy "own rows" on public.marketplace_listings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.items i where i.id = item_id and i.user_id = (select auth.uid()))
  );

-- Marketplace order lines already turned into sales (makes sale sync idempotent).
create table public.marketplace_sales (
  marketplace text not null,
  external_line_id text not null,
  external_order_id text,
  user_id uuid not null references auth.users on delete cascade,
  item_id uuid references public.items on delete set null,
  created_at timestamptz not null default now(),
  primary key (marketplace, external_line_id)
);
alter table public.marketplace_sales enable row level security;
create policy "own rows read" on public.marketplace_sales for select to authenticated
  using (user_id = (select auth.uid()));
