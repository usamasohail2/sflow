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
- `AUTH_URL` (e.g. `https://itw-sectors.vercel.app`)

Add Google OAuth redirect: `https://itw-sectors.vercel.app/api/auth/callback/google`
