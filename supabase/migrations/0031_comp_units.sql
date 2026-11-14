-- Units per eBay listing for Scan to Comp (from CompAmp): a listing that sold 10 boxes is 10 sales,
-- not 1. Read from the Browse API (estimatedSoldQuantity) once per listing and shared by everyone.
create table public.comp_items (
  item_id text primary key,
  -- Units the listing has sold; null when eBay had no details (ended, removed, multi-variation): counts as 1.
  sold_qty integer,
  created_on date,
  ended boolean not null default false,
  fetched_at timestamptz not null default now()
);
alter table public.comp_items enable row level security;
-- No policies: only the server (service role) reads and writes it.

-- Auctions always sell one unit, so they're never looked up.
alter table public.comp_sales add column auction boolean not null default false;
