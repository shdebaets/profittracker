-- Tax tools: the seller's estimated bracket, mileage log locations, and the
-- 1099-K totals marketplaces reported (typed in by the seller) for reconciling.

alter table public.settings
  add column tax_bracket numeric(4, 3) not null default 0.22 check (tax_bracket >= 0 and tax_bracket <= 0.5),
  add column tax_bracket_set boolean not null default false;

alter table public.expenses
  add column start_location text,
  add column end_location text;

create table public.tax_forms (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  tax_year integer not null check (tax_year between 2000 and 2100),
  platform text not null,
  gross_cents bigint not null check (gross_cents >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, tax_year, platform)
);
alter table public.tax_forms enable row level security;
create policy "own rows" on public.tax_forms for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
