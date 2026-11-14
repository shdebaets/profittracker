-- Smart Offers on Poshmark and Mercari, the assisted way: FlipLedger works out the offer and the
-- extension fills the site's "offer to likers" form; the seller sends it. Logged like eBay offers.
alter table public.smart_offers add column if not exists marketplace text not null default 'ebay';
