-- 1099-K reconciler: what a sale's 1099-K gross includes that isn't income.
-- sales_tax_cents: sales tax the marketplace collected from the buyer (pass-through, not income).
-- refund_cents: money refunded to the buyer after the sale (Schedule C line 2, returns and allowances).
-- facebook: a fee preset for shipped Facebook Marketplace sales, so they count as Facebook on taxes.
-- cancelled_sales: sales that were cancelled but can still appear on a 1099-K (Poshmark does this).

alter table public.items
  add column sales_tax_cents integer not null default 0 check (sales_tax_cents >= 0),
  add column refund_cents integer not null default 0 check (refund_cents >= 0);

alter table public.items drop constraint if exists items_platform_check;
alter table public.items add constraint items_platform_check
  check (platform in ('cash', 'card', 'mercari_depop', 'ebay', 'poshmark_amz', 'facebook', 'custom'));

create table public.cancelled_sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  platform text not null check (platform in ('ebay', 'mercari', 'poshmark', 'facebook', 'depop', 'local', 'other')),
  cancelled_at timestamptz not null default now(),
  gross_cents integer not null check (gross_cents >= 0),
  title text check (char_length(title) <= 200),
  -- Marketplace order id for synced cancellations, so a re-sync doesn't double count.
  external_id text,
  created_at timestamptz not null default now(),
  unique (user_id, platform, external_id)
);
create index cancelled_sales_user_date on public.cancelled_sales (user_id, cancelled_at);
alter table public.cancelled_sales enable row level security;
create policy "own rows" on public.cancelled_sales for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
