# Islamabad Events & Places Map

Discover events and interesting places in Islamabad on an interactive map. Anyone can suggest a listing; you approve it in Airtable before it goes public.

## Tech stack

- **Next.js 14** (App Router) + TypeScript + Tailwind CSS
- **Airtable** for curated spots/events (server-side API routes)
- **Supabase** (optional, preferred) for live explorers + public chat
- **Mapbox GL JS** via `react-map-gl`
- **Vercel** for hosting

Sprites: [Animated Warrior](https://opengameart.org/content/animated-warrior) by Calciumtrice (CC BY 3.0); ghost by ImogiaGames / Balmer (CC0); skeleton by Balmer (CC0). See `public/sprites/ATTRIBUTION.md`.

## Local setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Description |
|---|---|
| `AIRTABLE_TOKEN` | Personal access token from [Airtable](https://airtable.com/create/tokens) with `data.records:read` and `data.records:write` |
| `AIRTABLE_BASE_ID` | Base ID from your Airtable URL (`https://airtable.com/appXXXXXXXX/...`) |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Public token from [Mapbox](https://account.mapbox.com/access-tokens/) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (Settings → API) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service_role** key (server only — never expose in the browser) |
| `UPSTASH_REDIS_REST_URL` | Optional fallback — Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Optional fallback — Upstash Redis REST token |
| `AUTH_SECRET` | Random secret for Auth.js sessions (`openssl rand -base64 32`) |
| `AUTH_URL` | App origin, e.g. `http://localhost:3000` |
| `AUTH_GOOGLE_ID` | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret |

### Supabase (live explorers + chat)

1. Create a free project at [supabase.com/dashboard](https://supabase.com/dashboard)
2. Open **SQL Editor** → New query → paste `supabase/schema.sql` → **Run**
3. Open **Project Settings → API** and copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`
4. Restart `npm run dev`

Priority for live data: **Supabase → Redis → Airtable/memory**. Spots/events stay in Airtable.

### Google sign-in

1. Create an OAuth client in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (type: Web application)
2. Add authorized redirect URI: `http://localhost:3000/api/auth/callback/google` (and your production URL’s `/api/auth/callback/google`)
3. Paste the client ID/secret into `.env.local` as `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`
4. Restart `npm run dev` — use **Sign in** in the top-right chrome (or `/login`)

Spots without uploaded photos show a category-colored placeholder (no stock Unsplash images).

### Airtable table: `Entries`

| Field | Type | Notes |
|---|---|---|
| `Type` | Single select | `Event`, `Place` (app also accepts lowercase) |
| `Title` | Single line text | Required |
| `Description` | Long text | Optional; may include `Contact: …` / `Time: …` metadata lines |
| `Organizer` | Single line text | **Required column** — submitter’s name (queryable). Create this field if missing. |
| `Category` | Single select | `food`, `scenic`, `hidden`, `activity` |
| `Lat` / `Lng` | Number | Optional coordinates |
| `LocationText` | Single line text | Fallback / TBD |
| `SourceURL` | URL | Optional |
| `EventDate` / `EventEndDate` | Date | Events only |
| `Status` | Single select | `pending` (default), `approved`, `rejected` |
| `Photos` | Attachment | Optional — user uploads from the suggest form (up to 3) |

### Airtable table: `Subscribers`

Create a second table in the same base for “Stay updated” signups:

| Field | Type | Notes |
|---|---|---|
| `Email` | Email or single line text | Required, unique-ish |
| `Status` | Single select | `active` (default), optional `unsubscribed` |

### Airtable table: `Comments`

Create a third table for map-popup comments on spots and events:

| Field | Type | Notes |
|---|---|---|
| `EntryId` | Single line text | Required — Airtable record ID of the listing (e.g. `rec…`) |
| `Body` | Long text | Comment text |
| `AuthorName` | Single line text | Display name (user-provided or auto-generated) |
| `Status` | Single select | `approved` (default), `rejected` — set `rejected` to hide |

Comments appear in the map pin popup. Name is optional; blank names get a random username (e.g. `SillyPanda`).

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## How testers use it

1. Browse the list + map; filter by All / Events / Places, category, and date
2. Click a listing or map pin to sync selection
3. Use **Suggest** to submit a place or event (saved as `pending`)
4. Pending listings show on the map/list in amber until you approve them in Airtable

## Admin approval

1. Open the **Entries** table in Airtable
2. Filter `Status = pending`
3. Set `approved` or `rejected`
4. Approved keep orange/blue styling; rejected disappear from the site

## Deploy to Vercel (for user testing)

1. Push this repo to GitHub
2. Import the project at [vercel.com/new](https://vercel.com/new)
3. Add the same env vars as in `.env.local` (Production + Preview), including Upstash Redis for a real visitor count
4. Deploy — share the `*.vercel.app` URL with testers
5. In [Mapbox](https://account.mapbox.com/access-tokens/), allow your Vercel domain on the public token (URL restrictions), or testers may see a blank map

```bash
npm run build   # sanity-check locally before deploy
```

Airtable credentials stay server-side; only `NEXT_PUBLIC_MAPBOX_TOKEN` is exposed to the browser.

## API

- `GET /api/entries` — approved + pending entries (rejected excluded)
- `POST /api/entries` — create pending entry (honeypot field: `website`)
- `GET /api/comments?entryId=` — comments for a listing
- `POST /api/comments` — post a comment (`entryId`, `body`, optional `authorName`; honeypot: `website`)
- `POST /api/subscribe` — email signup for updates (honeypot field: `website`)
- `GET` / `POST /api/presence` — live viewer heartbeat (`visitorId`); returns `{ viewers, shared }`

Emails are stored in Airtable only — send digests yourself (or wire Mailchimp/Resend later).
