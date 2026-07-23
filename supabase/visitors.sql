-- Unique map explorers (first visit + last seen)
-- Run once in Supabase SQL Editor if the table does not exist yet.

create table if not exists public.visitors (
  visitor_id text primary key,
  name text not null default 'Explorer',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  visit_count integer not null default 1
);

create index if not exists visitors_first_seen_idx
  on public.visitors (first_seen desc);

create index if not exists visitors_last_seen_idx
  on public.visitors (last_seen desc);

alter table public.visitors enable row level security;

drop policy if exists "deny all visitors" on public.visitors;
create policy "deny all visitors"
  on public.visitors
  for all
  to anon, authenticated
  using (false)
  with check (false);
