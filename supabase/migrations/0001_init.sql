-- FlipLedger schema. All money is integer cents. Every table is owner-scoped via RLS.

create table public.hauls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text,
  store text,
  total_cents integer not null check (total_cents >= 0),
  purchased_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  seq integer not null default 0,
  title text,
  status text not null check (status in ('inventory', 'sold', 'returned')),
  quantity integer not null default 1 check (quantity > 0),
  cost_cents integer not null default 0 check (cost_cents >= 0),
  purchased_at timestamptz not null default now(),
  store text,
  link_url text,
  haul_id uuid references public.hauls on delete set null,
  sale_price_cents integer check (sale_price_cents >= 0),
  buyer_shipping_cents integer not null default 0,
  label_cost_cents integer not null default 0,
  fee_pct numeric(6, 5) not null default 0,
  fee_fixed_cents integer not null default 0,
  platform text check (platform in ('cash', 'card', 'mercari_depop', 'ebay', 'poshmark_amz', 'custom')),
  sold_at timestamptz,
  returnable boolean not null default false,
  return_deadline date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index items_user_status_idx on public.items (user_id, status);
create index items_user_sold_at_idx on public.items (user_id, sold_at desc);

-- Per-user running item number (#1, #2, ...).
create function public.items_assign_seq() returns trigger
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));
  select coalesce(max(seq), 0) + 1 into new.seq from public.items where user_id = new.user_id;
  return new;
end $$;
create trigger items_assign_seq before insert on public.items
  for each row execute function public.items_assign_seq();

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null default 'expense' check (kind in ('expense', 'mileage')),
  title text not null,
  category text not null default 'Other',
  amount_cents integer not null check (amount_cents >= 0),
  spent_at timestamptz not null default now(),
  miles numeric(8, 1),
  rate_cents integer,
  created_at timestamptz not null default now()
);
create index expenses_user_spent_idx on public.expenses (user_id, spent_at desc);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  amount_cents integer not null check (amount_cents >= 0),
  active boolean not null default true,
  started_at date not null default current_date,
  created_at timestamptz not null default now()
);

create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  mileage_rate_cents integer not null default 76,
  default_return_days integer not null default 90
);

-- Row Level Security: each user only ever sees their own rows.
do $$
declare t text;
begin
  foreach t in array array['hauls', 'items', 'expenses', 'subscriptions', 'settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
