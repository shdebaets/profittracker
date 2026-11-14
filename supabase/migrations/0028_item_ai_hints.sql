-- What "Write it from photos" suggested beyond the listing fields: eBay category and item
-- specifics, Mercari and Poshmark category paths, and a short Facebook title. Kept on the item
-- so the eBay form and the extension can use them whenever the seller lists, not just right after.
alter table public.items
  add column ai_hints jsonb;
