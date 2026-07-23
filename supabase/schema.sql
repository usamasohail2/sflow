-- Islamabad Explore — live presence + public chat
-- Run this once in the Supabase SQL Editor (Dashboard → SQL → New query).
-- Then copy Project URL + service_role key into .env.local

-- Presence: one row per live explorer (upserted on heartbeat / camera move)
create table if not exists public.live_presence (
  visitor_id text primary key,
  name text not null default 'Explorer',
  lat double precision,
  lng double precision,
  alt double precision,
  color integer not null default 0,
  last_seen timestamptz not null default now()
);

create index if not exists live_presence_last_seen_idx
  on public.live_presence (last_seen desc);

-- Public map chat (short-lived messages; app keeps ~80 newest)
create table if not exists public.chat_messages (
  id text primary key,
  visitor_id text not null,
  name text not null default 'Explorer',
  text text not null,
  color integer not null default 0,
  lat double precision,
  lng double precision,
  alt double precision,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_created_at_idx
  on public.chat_messages (created_at desc);

-- Server uses the service_role key (bypasses RLS). Keep policies locked down
-- so the anon key cannot write if it ever leaks into the client.
alter table public.live_presence enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "deny all live_presence" on public.live_presence;
create policy "deny all live_presence"
  on public.live_presence
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "deny all chat_messages" on public.chat_messages;
create policy "deny all chat_messages"
  on public.chat_messages
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- Signed-in users (Google OAuth via Auth.js) — oversee in Table Editor → profiles
create table if not exists public.profiles (
  id text primary key,
  email text,
  name text,
  image text,
  provider text not null default 'google',
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create index if not exists profiles_last_seen_idx
  on public.profiles (last_seen desc);

create index if not exists profiles_email_idx
  on public.profiles (email);

alter table public.profiles enable row level security;

drop policy if exists "deny all profiles" on public.profiles;
create policy "deny all profiles"
  on public.profiles
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- Durable unique explorers (all-time / monthly analytics)
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

-- Optional: enable Realtime later for push updates
-- alter publication supabase_realtime add table public.live_presence;
-- alter publication supabase_realtime add table public.chat_messages;
