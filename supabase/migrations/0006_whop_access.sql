-- Whop sign-in and paid access. One row per FlipLedger user who signed in with Whop.
-- RLS on with no policies: only the service role reads or writes it, so nobody can
-- grant themselves access by setting has_access.
create table public.whop_links (
  user_id uuid primary key references auth.users on delete cascade,
  whop_user_id text not null unique,
  whop_username text,
  has_access boolean not null default false,
  checked_at timestamptz
);

alter table public.whop_links enable row level security;
