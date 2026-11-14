-- CompAmp's AI judge in Scan to Comp: whether a listing title is the exact product being comped
-- (not a case, a lot, a part, or another model). Shared cache, so each title is judged once.
create table public.comp_judgments (
  query_key text not null,
  title_hash text not null,
  keep boolean not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (query_key, title_hash)
);
alter table public.comp_judgments enable row level security;
-- No policies: only the server (service role) reads and writes it.
