# Islamabad Events & Places Map

Discover events and interesting places in Islamabad on an interactive map. Anyone can suggest a listing; you approve it in Airtable before it goes public.

## Tech stack

- **Next.js 14** (App Router) + TypeScript + Tailwind CSS
- **Airtable** as the database (server-side API routes only)
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
| `UPSTASH_REDIS_REST_URL` | Optional — Upstash Redis REST URL (preferred for live viewer count) |
| `UPSTASH_REDIS_REST_TOKEN` | Optional — Upstash Redis REST token |

Live “people viewing” uses **Upstash Redis** when set, otherwise **Airtable** (rejected `__presence__:` rows in `Entries`), otherwise in-memory (local only).

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
