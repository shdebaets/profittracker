-- Push notifications get their own switches, separate from the emails, so a seller can keep the
-- Sunday recap push with the email off (or the other way round). On by default; a push only reaches
-- devices that turned notifications on in Settings.
alter table public.settings
  add column push_recap boolean not null default true,
  add column push_tax_reminders boolean not null default true;
