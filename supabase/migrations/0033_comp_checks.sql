-- Scan to Comp fair use: one row per member per product checked, for the "5 products a day" cap.
-- Re-opening a product already checked in the last 24 hours doesn't add a row.
create table public.comp_checks (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  query_key text not null,
  created_at timestamptz not null default now()
);
create index comp_checks_user_created_idx on public.comp_checks (user_id, created_at desc);
alter table public.comp_checks enable row level security;
-- Members can read their own (the comp screen shows how many are left); writes go through the service role.
create policy comp_checks_select_own on public.comp_checks for select using (user_id = (select auth.uid()));

-- Paid sold-data requests per UTC day, counted atomically (comp_cache key 'paid-sold-calls:<date>').
-- The old count summed the read markers, which a re-read of the same product overwrites, so it
-- undercounted. Service role only.
create function public.comp_count_add(p_key text, p_n integer) returns integer
language sql security definer set search_path = public as $$
  insert into public.comp_cache (key, payload, fetched_at)
  values (p_key, jsonb_build_object('calls', p_n, 'requests', 0), now())
  on conflict (key) do update
    set payload = jsonb_set(public.comp_cache.payload, '{calls}', to_jsonb(coalesce((public.comp_cache.payload->>'calls')::integer, 0) + p_n)),
        fetched_at = now()
  returning (payload->>'calls')::integer;
$$;
revoke execute on function public.comp_count_add(text, integer) from public, anon, authenticated;
