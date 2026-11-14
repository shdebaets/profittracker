-- Emails FlipLedger sends: the Sunday profit recap and quarterly estimated tax reminders.
-- On by default; every email has a one-click unsubscribe link.
alter table public.settings
  add column email_recap boolean not null default true,
  add column email_tax_reminders boolean not null default true;

-- Which emails went out, so a re-run of the daily cron never sends twice.
create table public.email_log (
  user_id uuid not null references auth.users on delete cascade,
  kind text not null,
  period_key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, period_key)
);
alter table public.email_log enable row level security;
