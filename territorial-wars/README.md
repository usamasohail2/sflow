# Islamabad Territorial Wars

Separate game from Islamabad Explore.

## Live

https://itw-sectors.vercel.app

## How to play (MVP)

1. **Draw sectors** at `/edit` — tap corners on the map, close & name, save (Google sign-in required to save).
2. **Play** at `/play` — sign in with Google.
3. Set your location (GPS or click the map to drop a pin).
4. Select a sector you’re inside → **Station villagers**.
5. **Place a house** (uses a house slot).
6. **Invite a friend** with your link → you get +1 villager and +1 house slot.
7. Villagers dig **+1 resource / villager / 0.5s** in their stationed sector.

## Dev

```bash
cd territorial-wars
npm install
npm run dev
```

## Env

- `NEXT_PUBLIC_MAPBOX_TOKEN`
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
- `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
- `AUTH_URL` / `NEXT_PUBLIC_SITE_URL` (e.g. `https://www.wars.usama.fun`)

Canonical site host is **`https://www.wars.usama.fun`** (`AUTH_URL`). Apex
`wars.usama.fun` / `usama.fun` redirect there via middleware so Google OAuth
cookies and the callback host always match (avoids “sign in twice”).

In [Google Cloud Console → Credentials → OAuth client](https://console.cloud.google.com/apis/credentials), add:

**Authorized JavaScript origins**
- `https://www.wars.usama.fun`

**Authorized redirect URIs**
- `https://www.wars.usama.fun/api/auth/callback/google`
