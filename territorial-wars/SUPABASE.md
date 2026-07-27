# Supabase setup (permanent game database)

Redis was never connected on production (empty credentials). **Supabase Postgres** is the durable store.

## 1. Create a free project

1. Go to [https://supabase.com](https://supabase.com) → New project
2. Pick a region close to you (e.g. Singapore / Mumbai)
3. Save the database password

## 2. Create the table

In Supabase → **SQL Editor** → New query, paste and run everything in:

`supabase/schema.sql`

## 3. Copy API keys

Supabase → **Project Settings → API**:

| Env var | Value |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` secret (not the anon key) |

## 4. Add to Vercel

Vercel → `itw-sectors` → Settings → Environment Variables → add both for **Production** (and Preview).

Redeploy (or let the next push deploy).

## 5. Verify

Open `/play` or `/edit`. The UI shows storage as **supabase** when connected.

First boot with Supabase empty will auto-import whatever was in Vercel Blob (sectors/players), then use Postgres forever.

## Why not Airtable?

Airtable rate-limits and can’t do safe concurrent player updates. Postgres (Supabase) can.
