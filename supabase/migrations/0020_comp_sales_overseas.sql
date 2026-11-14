-- Sold listings from sellers outside the US (the data provider gives each sale's item location).
-- Their prices are converted and often include VAT, so they count as sales but stay out of prices.
alter table public.comp_sales add column if not exists overseas boolean not null default false;
