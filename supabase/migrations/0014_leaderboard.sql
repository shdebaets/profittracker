-- Community leaderboard: opt-in only. Shows the name the seller picks (default: initials).
create table public.leaderboard_profiles (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  opted_in boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.leaderboard_profiles enable row level security;
create policy "own rows" on public.leaderboard_profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- Other people's rows are read only on the server (service role) and only for opted-in sellers.
