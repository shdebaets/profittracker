-- Each listing's eBay sold count, one row per day it was read (Browse estimatedSoldQuantity).
-- Units sold on a day = the change from the reading before. eBay's lifetime count can't say when
-- units sold (a relisted listing keeps its old total), so spreading it over the listing's life
-- overcounted busy products (Night, Nov 16: 648-801 a week against Terapeak's ~350-400).
-- Service role only, like comp_items.
create table public.comp_item_counts (
  item_id text not null,
  day date not null,
  sold_qty integer not null,
  primary key (item_id, day)
);
alter table public.comp_item_counts enable row level security;

-- First readings from what's already on file, so changes can start counting from tomorrow.
insert into public.comp_item_counts (item_id, day, sold_qty)
select item_id, (fetched_at at time zone 'America/New_York')::date, sold_qty
from public.comp_items
where sold_qty is not null
on conflict do nothing;
