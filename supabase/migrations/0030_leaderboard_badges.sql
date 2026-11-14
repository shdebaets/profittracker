-- Monthly leaderboard badges: the top 3 on each board (profit, items sold, miles) for a month,
-- awarded once by the daily cron after the month ends. The name is a snapshot from award time.
create table if not exists public.leaderboard_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  year integer not null check (year between 2024 and 2100),
  month integer not null check (month between 0 and 11), -- 0 = January, like JS dates
  board text not null check (board in ('profit', 'itemsSold', 'miles')),
  place integer not null check (place between 1 and 3),
  display_name text not null,
  value numeric not null,
  awarded_at timestamptz not null default now(),
  unique (year, month, board, place)
);
create index if not exists leaderboard_badges_user_idx on public.leaderboard_badges (user_id, year desc, month desc);
alter table public.leaderboard_badges enable row level security;
-- Sellers read their own badges. Writes and other sellers' badges go through the service role
-- (the board only shows names next to badges, like the board itself).
drop policy if exists "own rows read" on public.leaderboard_badges;
create policy "own rows read" on public.leaderboard_badges for select to authenticated
  using (user_id = (select auth.uid()));
