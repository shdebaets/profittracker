-- Weekly alert digest ("4 stale, 2 overpriced"): a push plus an email, on by default.
-- One switch covers both; the email has a one-click unsubscribe link (kind "alerts").
alter table public.settings
  add column email_alerts boolean not null default true;
