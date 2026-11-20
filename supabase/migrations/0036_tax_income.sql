-- Sellers can work out their federal bracket from filing status + expected yearly income
-- (Settings). The bracket still lives in settings.tax_bracket; these keep what they typed.
alter table public.settings
  add column if not exists tax_filing_status text check (tax_filing_status in ('single', 'mfj', 'hoh')),
  add column if not exists tax_income_cents bigint check (tax_income_cents >= 0);
