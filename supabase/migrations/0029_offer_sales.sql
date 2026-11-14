-- Smart Offers outcomes from real sales: each offer is linked to the sale it led to (a
-- marketplace_sales line), with what the buyer actually paid. Sales now keep their amount.
alter table public.marketplace_sales
  add column if not exists sale_cents integer,      -- per unit, before shipping and fees
  add column if not exists quantity integer,
  add column if not exists sold_at timestamptz;

alter table public.smart_offers
  add column if not exists sale_marketplace text,
  add column if not exists sale_line_id text,
  add column if not exists sale_cents integer,      -- total paid for the units sold
  add column if not exists sold_at timestamptz,
  add column if not exists settled_at timestamptz;

-- One sale can be credited to one offer only.
create unique index if not exists smart_offers_sale_idx
  on public.smart_offers (sale_marketplace, sale_line_id) where sale_line_id is not null;
create index if not exists smart_offers_open_idx on public.smart_offers (sent_at) where outcome is null and error is null;
create index if not exists smart_offers_listing_idx on public.smart_offers (user_id, marketplace, listing_id, sent_at desc);
create index if not exists marketplace_sales_item_idx on public.marketplace_sales (item_id);
