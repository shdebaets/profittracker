-- Orders: which marketplace an item sold on, whether it has shipped, and eBay's
-- buyer / ship-by / fulfillment status for each sale. `category` is for analytics and AI fill.

alter table public.items
  add column sold_on text
    check (sold_on in ('ebay', 'mercari', 'facebook', 'depop', 'vinted', 'poshmark', 'etsy')),
  add column category text check (char_length(category) <= 200),
  add column shipped_at timestamptz;

alter table public.marketplace_sales
  add column buyer text,
  add column ship_by timestamptz,
  -- eBay orderFulfillmentStatus: NOT_STARTED, IN_PROGRESS or FULFILLED.
  add column order_status text;

-- Backfill sold_on. A listing marked sold is the surest sign; then a recorded marketplace
-- sale; then the eBay fee preset (the other presets are shared by several sites).
update public.items i set sold_on = l.marketplace
from public.marketplace_listings l
where l.item_id = i.id and l.status = 'sold' and i.status = 'sold' and i.sold_on is null;

update public.items i set sold_on = s.marketplace
from public.marketplace_sales s
where s.item_id = i.id and i.status = 'sold' and i.sold_on is null;

update public.items set sold_on = 'ebay'
where status = 'sold' and sold_on is null and platform = 'ebay';

-- Sales from before Orders existed were shipped long ago; start with an empty "To ship" list.
update public.items set shipped_at = coalesce(sold_at, updated_at)
where status = 'sold' and shipped_at is null;

create index items_user_to_ship on public.items (user_id, sold_at desc)
  where status = 'sold' and shipped_at is null;
