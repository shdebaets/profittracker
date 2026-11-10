-- Research: eBay price tracking for a product (live listings, sold history, verdicts).
-- Research data is shared: one product is researched once and every signed-in user reads
-- the same numbers, so eBay's daily API quota and AI cost scale with products, not users.
-- Only the server (service role) writes research data. Each user keeps their own watchlist
-- with their cost price, and is limited to a few brand-new product checks per day.

create table public.research_products (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  name text not null,
  image_url text,
  profile jsonb not null default '{}',
  examples jsonb not null default '[]',
  status text not null default 'active' check (status in ('active', 'paused')),
  last_refresh_at timestamptz,
  last_status text,
  last_error text,
  sold_collected_at timestamptz,
  -- Headline numbers cached when a run finishes, so lists never load every listing.
  summary jsonb,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table public.research_listings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.research_products on delete cascade,
  item_id text not null,
  legacy_id text,
  title text not null,
  price numeric,
  shipping numeric,
  currency text,
  condition text,
  category text,
  seller text,
  seller_feedback integer,
  buying_options text[] not null default '{}',
  image_url text,
  url text,
  matched_keywords text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'counted', 'review', 'rejected')),
  version_key text,
  reason text,
  confidence numeric,
  judged_by text,
  judge_attempts integer not null default 0,
  presale boolean not null default false,
  best_offer boolean not null default false,
  start_date timestamptz,
  end_date timestamptz,
  sold_qty integer,
  avail_qty integer,
  specifics jsonb,
  details_state text not null default 'pending' check (details_state in ('pending', 'available', 'unavailable')),
  details_fetched_at timestamptz,
  live boolean not null default true,
  first_seen date not null default current_date,
  last_seen date not null default current_date,
  search_run_id uuid,
  unique (product_id, item_id)
);
create index research_listings_product_status_idx on public.research_listings (product_id, status);

create table public.research_sales (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.research_products on delete cascade,
  external_id text not null,
  listing_id uuid references public.research_listings on delete set null,
  source text not null default 'collector' check (source in ('collector', 'tracker')),
  version_key text,
  verdict text not null default 'pending',
  reason text,
  judge_attempts integer not null default 0,
  human_decision boolean not null default false,
  sold_on date not null,
  title text,
  url text,
  price numeric,
  shipping numeric,
  best_offer boolean not null default false,
  presale boolean not null default false,
  format text,
  condition text,
  seller text,
  variants_matched text[] not null default '{}',
  qty integer not null default 1,
  units integer not null default 1,
  volume_days jsonb not null default '[]',
  listing_created_at timestamptz,
  specifics jsonb,
  details_state text not null default 'pending' check (details_state in ('pending', 'available', 'unavailable')),
  collected_at timestamptz,
  created_at timestamptz not null default now(),
  unique (product_id, source, external_id)
);
create index research_sales_product_sold_idx on public.research_sales (product_id, sold_on);

create table public.research_snapshots (
  listing_id uuid not null references public.research_listings on delete cascade,
  product_id uuid not null references public.research_products on delete cascade,
  day date not null,
  price numeric,
  shipping numeric,
  sold_qty integer,
  avail_qty integer,
  primary key (listing_id, day)
);

-- One row per background run (a Vercel Workflow run). Progress is shown on the item page.
create table public.research_runs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.research_products on delete cascade,
  kind text not null check (kind in ('track', 'sold')),
  workflow_run_id text,
  status text not null default 'running' check (status in ('running', 'done', 'error', 'paused', 'superseded')),
  step text not null default 'search',
  progress jsonb not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index research_runs_product_idx on public.research_runs (product_id, kind, created_at desc);

-- A user's own research list: their cost price and notes per product.
create table public.research_watch (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  product_id uuid not null references public.research_products on delete cascade,
  cost_cents integer check (cost_cents >= 0),
  sale_price_cents integer check (sale_price_cents >= 0),
  item_id uuid references public.items on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

-- Team accounts: no daily limit and can approve listings held for review.
create table public.research_members (
  user_id uuid primary key references auth.users on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

-- New product checks per user per day (the free allowance).
create table public.research_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  new_checks integer not null default 0,
  primary key (user_id, day)
);

-- Provider calls and AI cost per day (eBay Browse quota is per app, shared by everyone).
create table public.research_api_usage (
  day date not null,
  kind text not null,
  model text not null default '',
  calls integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost numeric not null default 0,
  primary key (day, kind, model)
);

-- Atomic counters for the server.
create function public.research_bump_usage(_day date, _kind text, _model text, _calls integer, _in bigint, _out bigint, _cost numeric)
returns void language sql security definer set search_path = public as $$
  insert into public.research_api_usage as u (day, kind, model, calls, input_tokens, output_tokens, cost)
  values (_day, _kind, _model, _calls, _in, _out, _cost)
  on conflict (day, kind, model) do update set
    calls = u.calls + excluded.calls,
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    cost = u.cost + excluded.cost
$$;

-- Take one of today's free checks. Returns false when the allowance is used up.
create function public.research_take_check(_user uuid, _day date, _limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare used integer;
begin
  if exists (select 1 from public.research_members where user_id = _user) then return true; end if;
  insert into public.research_usage (user_id, day, new_checks) values (_user, _day, 0)
    on conflict (user_id, day) do nothing;
  update public.research_usage set new_checks = new_checks + 1
    where user_id = _user and day = _day and new_checks < _limit
    returning new_checks into used;
  return used is not null;
end $$;
revoke execute on function public.research_bump_usage from public, anon, authenticated;
revoke execute on function public.research_take_check from public, anon, authenticated;

-- RLS: shared research is readable by any signed-in user and written only by the server.
do $$
declare t text;
begin
  foreach t in array array['research_products', 'research_listings', 'research_sales', 'research_snapshots', 'research_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "signed-in read" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

alter table public.research_watch enable row level security;
create policy "own rows" on public.research_watch for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.research_members enable row level security;
create policy "own row read" on public.research_members for select to authenticated
  using (user_id = (select auth.uid()));

alter table public.research_usage enable row level security;
create policy "own rows read" on public.research_usage for select to authenticated
  using (user_id = (select auth.uid()));

-- research_api_usage: no policies (server only).
alter table public.research_api_usage enable row level security;
