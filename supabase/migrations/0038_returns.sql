-- Returned inventory (tracker row 19).
--
-- 1. Taking unsold stock back to the store: a `returned` row keeps when it went back, the refund the
--    store gave (null = not entered, counted as a full refund) and whether it has arrived, plus what
--    the return cost (restocking fee, postage, gas). cost - refund + return cost is a loss.
-- 2. A buyer sending a sold item back: the sold row stays sold (it's still on the 1099-K) with
--    refund_cents set; restocked = the unit went back into inventory as a new row, so its cost
--    leaves this sale's COGS. Fees the marketplace gave back and the return label are recorded too.
alter table public.items
  add column if not exists returned_at timestamptz,
  add column if not exists store_refund_cents integer check (store_refund_cents >= 0),
  add column if not exists store_refund_received_at timestamptz,
  add column if not exists return_cost_cents integer not null default 0 check (return_cost_cents >= 0),
  add column if not exists buyer_returned_at timestamptz,
  add column if not exists restocked boolean not null default false,
  add column if not exists return_label_cents integer not null default 0 check (return_label_cents >= 0),
  add column if not exists fee_credit_cents integer not null default 0 check (fee_credit_cents >= 0),
  -- The inventory row a buyer return put back, so undoing the return can remove it.
  add column if not exists restocked_item_id uuid references public.items on delete set null;

-- Rows already marked returned before this: date them by their last update.
update public.items set returned_at = updated_at where status = 'returned' and returned_at is null;
