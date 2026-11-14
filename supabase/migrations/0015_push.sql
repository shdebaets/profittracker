-- Web push subscriptions, one row per browser/device that turned on notifications.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
create policy "own push subs read" on public.push_subscriptions for select using (auth.uid() = user_id);
create policy "own push subs insert" on public.push_subscriptions for insert with check (auth.uid() = user_id);
create policy "own push subs delete" on public.push_subscriptions for delete using (auth.uid() = user_id);
