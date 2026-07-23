-- Signed-in users (Google OAuth via Auth.js)
-- Run in Supabase SQL Editor if you already applied the earlier schema.

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
