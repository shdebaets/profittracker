-- When the server last read this listing's public page for a sale (Poshmark).
alter table public.marketplace_listings add column checked_at timestamptz;
