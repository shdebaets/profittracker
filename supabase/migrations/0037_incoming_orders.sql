-- Incoming orders: online purchases on their way to the seller (Orders → Buying). They stay out of
-- items until "Mark received", so a cancelled order never touches stock value or profit.
-- One tracking number per order for now; live carrier status will get its own table.
create table public.incoming_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  retailer text check (char_length(retailer) <= 100),
  order_number text check (char_length(order_number) <= 100),
  ordered_at timestamptz not null default now(),
  status text not null default 'ordered' check (status in ('ordered', 'shipped', 'delivered', 'cancelled')),
  total_cents integer not null default 0 check (total_cents >= 0),
  -- [{ "title": text, "quantity": int, "estValueCents": int }]
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  tracking_number text check (char_length(tracking_number) <= 60),
  carrier text check (char_length(carrier) <= 20),
  returnable boolean not null default false,
  return_deadline date,
  note text check (char_length(note) <= 500),
  -- Set once the lines were added to inventory; haul_id when they became a lot.
  received_at timestamptz,
  haul_id uuid references public.hauls on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index incoming_orders_user_status on public.incoming_orders (user_id, status, ordered_at desc);
create trigger incoming_orders_touch before update on public.incoming_orders
  for each row execute function public.touch_updated_at();

alter table public.incoming_orders enable row level security;
create policy "own rows" on public.incoming_orders for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Return-deadline reminders (3 days and 1 day before), as an email and a push. On by default.
alter table public.settings
  add column if not exists email_returns boolean not null default true,
  add column if not exists push_returns boolean not null default true;
