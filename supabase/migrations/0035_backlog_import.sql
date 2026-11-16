-- Backlog import: items and expenses brought in from another tracker or a spreadsheet.
-- import_batch: one import run, so "Undo this import" removes exactly those rows.
-- import_ref: a stable hash of the source row, so importing the same file twice skips what's already in.
-- Partial sales insert the sold copy without import_ref (lib/items/sell.ts lists its columns).

alter table public.items
  add column import_batch uuid,
  add column import_ref text check (char_length(import_ref) <= 80);

alter table public.expenses
  add column import_batch uuid,
  add column import_ref text check (char_length(import_ref) <= 80);

create unique index items_import_ref on public.items (user_id, import_ref) where import_ref is not null;
create unique index expenses_import_ref on public.expenses (user_id, import_ref) where import_ref is not null;
create index items_import_batch on public.items (user_id, import_batch) where import_batch is not null;
create index expenses_import_batch on public.expenses (user_id, import_batch) where import_batch is not null;
