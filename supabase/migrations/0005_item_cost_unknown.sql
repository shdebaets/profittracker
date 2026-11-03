-- Items imported from a marketplace don't know what the seller paid. Flag them until
-- the seller enters a cost, so profit isn't silently computed against $0.
alter table public.items add column cost_unknown boolean not null default false;
