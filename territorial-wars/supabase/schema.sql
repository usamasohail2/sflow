-- Islamabad Territorial Wars — Supabase schema
-- Run this once in: Supabase Dashboard → SQL Editor → New query → Run
-- Then add SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to Vercel env.

create table if not exists itw_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists itw_kv_updated_at_idx on itw_kv (updated_at desc);

-- Service role bypasses RLS; lock the table down for anon/authenticated.
alter table itw_kv enable row level security;

-- No policies for anon/authenticated → only service role can read/write.
-- (Service role bypasses RLS by design.)

comment on table itw_kv is 'ITW durable game state (sectors, players, spots, events, public chat at itw:v3:chat)';
