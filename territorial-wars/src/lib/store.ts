import { createHash } from "crypto";
import { Redis } from "@upstash/redis";
import { head, put } from "@vercel/blob";
import {
  ATTACK_COOLDOWN_MS,
  BUILDING_CATALOG,
  EXPLORE_ZOOM,
  GATHER_TRIP_MS,
  GEM_META,
  HOUSE_FOOTPRINT_M,
  HOUSE_MAX_HP,
  FORTIFIED_HOUSE_MAX_HP,
  BASE_WALL_COST,
  INVITE_VILLAGER_BONUS,
  REVIEW_VILLAGER_BONUS,
  MAX_ROAM_FINDS,
  ROAM_METERS_TO_SPAWN,
  ROAM_MIN_EXPLORE_MS,
  ROCKET_COST,
  SPAWN_COOLDOWN_MS,
  AZAD_ARENA_NAME,
  AZAD_PLAY_RADIUS_M,
  STARTING,
  attackPower,
  azadHomeIdFor,
  buildingBonus,
  catalogItem,
  colorForPlayerId,
  defensePower,
  houseMaxHp,
  BUILDING_MAX_LEVEL,
  buildingLevel,
  buildingUpgradeCost,
  formatGold,
  isAzadHomeId,
  canUnlockFlexVehicles,
  isFlexVehicle,
  shovelDigYield,
  topScorerIdForHome,
  type BattleReport,
  type Building,
  type BuildingType,
  type GameEvent,
  type GameSnapshot,
  type GemType,
  type Player,
  type PublicPlayer,
  type ResourceSpot,
  type Sector,
  type SectorStatsPoint,
} from "@/lib/gameTypes";
import { sectorPointFromPlayers } from "@/lib/sectorAnalytics";
import { AUTH_DISABLED, buildDummySectors, isAdminEmail } from "@/lib/devMode";
import { pointInOrNearRing, pointInRing } from "@/lib/geo";
import {
  distMeters,
  offsetBearing,
  pickRoamGem,
  ringCentroid,
  seedSpotsForAzad,
  seedSpotsForSector,
} from "@/lib/mapMath";
import { accrueGather } from "@/lib/rules";
import { sendAttackEmail } from "@/lib/email";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import {
  chaseRaidTruck,
  destroySpySat,
  forceDispatchCdaTruck,
  placeCdaHqAt,
  plantSpySat,
  tickWorldNpcs,
} from "@/lib/npcLogic";
import type { WorldNpc } from "@/lib/worldNpcs";
import { isCdaTruck, isSpySat } from "@/lib/worldNpcs";

/**
 * Storage layout (v3) — granular keys so concurrent requests can't clobber
 * each other the way the old single-JSON-blob design did:
 *
 *   itw:v3:sectors        JSON Sector[]
 *   itw:v3:spots          JSON ResourceSpot[]
 *   itw:v3:pids           SET of player ids
 *   itw:v3:p:{id}         JSON Player
 *   itw:v3:invites        HASH inviteCode -> playerId
 *   itw:v3:events         LIST of JSON GameEvent (newest first)
 *   itw:v3:owner:{sid}    sector claim lock (SET NX -> playerId)
 *   itw:v3:sector_history JSON Record<sectorId, SectorStatsPoint[]> (oldest→newest)
 */

const P = "itw:v3";
const K_SECTORS = `${P}:sectors`;
const K_SPOTS = `${P}:spots`;
const K_PIDS = `${P}:pids`;
const K_INVITES = `${P}:invites`;
const K_EVENTS = `${P}:events`;
const K_SECTOR_HISTORY = `${P}:sector_history`;
const K_MIGRATED = `${P}:migrated`;
/** HASH playerId -> JSON Player backup while testing new-account tutorial */
const K_TUTORIAL_BACKUP = `${P}:tutorial_backup`;
/** JSON WorldNpc[] — CDA HQ, trucks, spy sats, roam NPCs */
const K_WORLD_NPCS = `${P}:world_npcs`;
const kPlayer = (id: string) => `${P}:p:${id}`;
const kOwner = (sid: string) => `${P}:owner:${sid}`;

/** Min gap between persisted growth samples per sector */
const SECTOR_HISTORY_INTERVAL_MS = 60 * 60 * 1000;
/** Keep about a week of hourly samples */
const SECTOR_HISTORY_MAX_POINTS = 168;

const LEGACY_BLOB_KEY = "itw:v2:state";

/** Legacy dummy enemy sector + bot — removed from the live map */
const DUMMY_ENEMY_SECTOR_ID = "sec_e7";
const BOT_ID = "bot_garrison";

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/* ------------------------------------------------------------------ */
/* In-memory store, durably backed by Vercel Blob when Redis is absent */
/* ------------------------------------------------------------------ */

type MemStore = {
  json: Map<string, unknown>;
  sets: Map<string, Set<string>>;
  hashes: Map<string, Map<string, string>>;
  lists: Map<string, string[]>;
};

const g = globalThis as unknown as {
  __itwMem?: MemStore;
  __itwBlobHydratedAt?: number;
  __itwBlobDirty?: boolean;
  __itwFlushPromise?: Promise<void> | null;
  /** One-shot migration: dummy E-7 enemy already purged in this isolate */
  __itwDummyPurged?: boolean;
  /** Last time sector history was checked/written (skip reads between) */
  __itwSectorHistAt?: number;
  __itwSectorHistCache?: Record<string, SectorStatsPoint[]>;
  /** playerId → last invite-index sync time */
  __itwInviteSyncAt?: Map<string, number>;
};
function mem(): MemStore {
  if (!g.__itwMem) {
    g.__itwMem = {
      json: new Map(),
      sets: new Map(),
      hashes: new Map(),
      lists: new Map(),
    };
  }
  return g.__itwMem;
}

const BLOB_HYDRATE_TTL_MS = 800;

function blobToken(): string | null {
  return process.env.BLOB_READ_WRITE_TOKEN || null;
}

function blobActive(): boolean {
  // Supabase is the durable primary — Blob is only a last-resort fallback
  return !supabaseConfigured() && !redis() && Boolean(blobToken());
}

export type StorageBackend = "supabase" | "redis" | "blob" | "memory";

export function storageBackend(): StorageBackend {
  if (supabaseConfigured()) return "supabase";
  if (redis()) return "redis";
  if (blobToken()) return "blob";
  return "memory";
}

/** Lightweight probe for /api/health — never throws. */
export async function getSystemHealth(): Promise<{
  ok: boolean;
  level: "ok" | "degraded" | "down";
  checkedAt: number;
  latencyMs: number;
  storage: {
    backend: StorageBackend;
    reachable: boolean;
    latencyMs: number | null;
    error?: string;
  };
  game: { sectors: number; players: number; events: number };
  env: {
    authSecret: boolean;
    googleOAuth: boolean;
    mapbox: boolean;
    authDisabled: boolean;
  };
  issues: string[];
}> {
  const started = Date.now();
  const issues: string[] = [];
  const backend = storageBackend();
  let storageLatency: number | null = null;
  let reachable = false;
  let storageError: string | undefined;
  let sectors = 0;
  let players = 0;
  let events = 0;

  try {
    const t0 = Date.now();
    await bootstrap();
    const [secs, pids, evRaw] = await Promise.all([
      getJSON<Sector[]>(K_SECTORS),
      sMembers(K_PIDS),
      lRangeAll(K_EVENTS, 5),
    ]);
    storageLatency = Date.now() - t0;
    reachable = true;
    sectors = Array.isArray(secs) ? secs.length : 0;
    players = pids.length;
    events = evRaw.length;
    if (backend === "memory") {
      issues.push("Storage is in-memory — state won't survive restarts");
    } else if (backend === "blob") {
      issues.push("Using Blob fallback — prefer Supabase for durability");
    }
    if (storageLatency > 2500) {
      issues.push(`Storage slow (${storageLatency}ms)`);
    }
    if (sectors === 0) {
      issues.push("No sectors loaded");
    }
  } catch (err) {
    reachable = false;
    storageError = err instanceof Error ? err.message : "Storage probe failed";
    issues.push(`Storage unreachable: ${storageError}`);
  }

  const env = {
    authSecret: Boolean(process.env.AUTH_SECRET?.trim()),
    googleOAuth: Boolean(
      process.env.AUTH_GOOGLE_ID?.trim() &&
        process.env.AUTH_GOOGLE_SECRET?.trim()
    ),
    mapbox: Boolean(process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim()),
    authDisabled: AUTH_DISABLED,
  };
  if (!env.mapbox) issues.push("Mapbox token missing");
  if (!env.authDisabled) {
    if (!env.authSecret) issues.push("AUTH_SECRET missing");
    if (!env.googleOAuth) issues.push("Google OAuth credentials missing");
  }

  const hardFail = !reachable;
  const level = hardFail
    ? "down"
    : issues.length > 0
      ? "degraded"
      : "ok";

  return {
    ok: !hardFail && issues.length === 0,
    level,
    checkedAt: Date.now(),
    latencyMs: Date.now() - started,
    storage: {
      backend,
      reachable,
      latencyMs: storageLatency,
      error: storageError,
    },
    game: { sectors, players, events },
    env,
    issues,
  };
}

/** Unguessable state path (blob store URLs are public) */
function blobStatePath(): string {
  const secret = process.env.AUTH_SECRET || "itw-fallback";
  return `itw/state-${createHash("sha256").update(secret).digest("hex").slice(0, 32)}.json`;
}

function markDirty(): void {
  g.__itwBlobDirty = true;
}

type SerializedState = {
  rev?: number;
  json: Record<string, unknown>;
  sets: Record<string, string[]>;
  hashes: Record<string, Record<string, string>>;
  lists: Record<string, string[]>;
};

function serializeMem(): SerializedState {
  const m = mem();
  return {
    json: Object.fromEntries(m.json),
    sets: Object.fromEntries(
      Array.from(m.sets.entries()).map(([k, v]) => [k, Array.from(v)])
    ),
    hashes: Object.fromEntries(
      Array.from(m.hashes.entries()).map(([k, v]) => [
        k,
        Object.fromEntries(v),
      ])
    ),
    lists: Object.fromEntries(m.lists),
  };
}

function applySerialized(data: SerializedState): void {
  const m = mem();
  m.json = new Map(Object.entries(data.json ?? {}));
  m.sets = new Map(
    Object.entries(data.sets ?? {}).map(([k, v]) => [k, new Set(v)])
  );
  m.hashes = new Map(
    Object.entries(data.hashes ?? {}).map(([k, v]) => [
      k,
      new Map(Object.entries(v)),
    ])
  );
  m.lists = new Map(Object.entries(data.lists ?? {}));
}

async function fetchRemoteState(): Promise<SerializedState | null> {
  try {
    const info = await head(blobStatePath(), { token: blobToken()! });
    const res = await fetch(`${info.url}?ts=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as SerializedState;
  } catch {
    return null;
  }
}

function mergeByIdUpdatedAt<T extends { id: string; updatedAt?: number }>(
  a: T[],
  b: T[]
): T[] {
  const map = new Map<string, T>();
  for (const item of a) map.set(item.id, item);
  for (const item of b) {
    const prev = map.get(item.id);
    if (!prev || (item.updatedAt ?? 0) >= (prev.updatedAt ?? 0)) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

/**
 * Merge remote + local so a slow poll can't wipe a concurrent settle.
 * Players: keep higher updatedAt. Sectors/spots: union by id.
 */
function mergeStates(
  remote: SerializedState | null,
  local: SerializedState
): SerializedState {
  if (!remote) return { ...local, rev: (local.rev ?? 0) + 1 };

  const json: Record<string, unknown> = { ...remote.json };
  for (const [k, lv] of Object.entries(local.json)) {
    const rv = remote.json[k];
    if (rv === undefined) {
      json[k] = lv;
      continue;
    }
    if (k.includes(":p:") && lv && rv && typeof lv === "object") {
      const lp = lv as Player;
      const rp = rv as Player;
      json[k] =
        (lp.updatedAt ?? 0) >= (rp.updatedAt ?? 0) ? lv : rv;
      continue;
    }
    if (k.endsWith(":sectors") && Array.isArray(lv) && Array.isArray(rv)) {
      json[k] = mergeByIdUpdatedAt(rv as Sector[], lv as Sector[]);
      continue;
    }
    if (k.endsWith(":spots") && Array.isArray(lv) && Array.isArray(rv)) {
      const map = new Map<string, ResourceSpot>();
      for (const s of rv as ResourceSpot[]) map.set(s.id, s);
      for (const s of lv as ResourceSpot[]) map.set(s.id, s);
      json[k] = Array.from(map.values());
      continue;
    }
    if (typeof lv === "number" && typeof rv === "number") {
      json[k] = Math.max(lv, rv);
      continue;
    }
    // Local write wins for other keys (owner locks, flags, etc.)
    json[k] = lv;
  }

  const sets: Record<string, string[]> = { ...remote.sets };
  for (const [k, lv] of Object.entries(local.sets)) {
    sets[k] = Array.from(new Set([...(remote.sets[k] ?? []), ...lv]));
  }

  const hashes: Record<string, Record<string, string>> = {
    ...remote.hashes,
  };
  for (const [k, lv] of Object.entries(local.hashes)) {
    hashes[k] = { ...(remote.hashes[k] ?? {}), ...lv };
  }

  const lists: Record<string, string[]> = {};
  const listKeys = Array.from(
    new Set([
      ...Object.keys(remote.lists ?? {}),
      ...Object.keys(local.lists ?? {}),
    ])
  );
  for (const k of listKeys) {
    const merged = [...(local.lists[k] ?? []), ...(remote.lists[k] ?? [])];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const row of merged) {
      try {
        const id = (JSON.parse(row) as { id?: string }).id ?? row;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(row);
      } catch {
        if (!seen.has(row)) {
          seen.add(row);
          out.push(row);
        }
      }
    }
    lists[k] = out.slice(0, 80);
  }

  return {
    rev: Math.max(remote.rev ?? 0, local.rev ?? 0) + 1,
    json,
    sets,
    hashes,
    lists,
  };
}

/** Pull the state document into memory (TTL-cached per lambda) */
async function hydrateFromBlob(): Promise<void> {
  if (!blobActive()) return;
  // Never clobber unflushed local writes (settle race)
  if (g.__itwBlobDirty) return;
  const now = Date.now();
  if (now - (g.__itwBlobHydratedAt ?? 0) < BLOB_HYDRATE_TTL_MS) return;
  g.__itwBlobHydratedAt = now;
  const data = await fetchRemoteState();
  if (!data) return;
  applySerialized(data);
  g.__itwBlobDirty = false;
}

/** Persist memory state to Blob if anything changed this request */
export async function flushStore(): Promise<void> {
  if (!blobActive() || !g.__itwBlobDirty) return;
  // Serialize concurrent flushes on the same isolate
  if (g.__itwFlushPromise) {
    await g.__itwFlushPromise;
    if (!g.__itwBlobDirty) return;
  }

  const run = async () => {
    const local = serializeMem();
    // Re-read remote and merge so a stale poll can't wipe a settle
    const remote = await fetchRemoteState();
    const merged = mergeStates(remote, local);
    try {
      await put(blobStatePath(), JSON.stringify(merged), {
        access: "public",
        token: blobToken()!,
        allowOverwrite: true,
        addRandomSuffix: false,
        cacheControlMaxAge: 0,
        contentType: "application/json",
      });
      applySerialized(merged);
      g.__itwBlobDirty = false;
      g.__itwBlobHydratedAt = Date.now();
    } catch (err) {
      g.__itwBlobDirty = true;
      console.error("Blob state flush failed:", err);
    }
  };

  g.__itwFlushPromise = run().finally(() => {
    g.__itwFlushPromise = null;
  });
  await g.__itwFlushPromise;
}

/* ------------------------------------------------------------------ */
/* Low-level ops — Supabase (primary) > Redis > Blob/memory            */
/* ------------------------------------------------------------------ */

async function sbGet<T>(key: string): Promise<T | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("itw_kv")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) {
    console.error("supabase get", key, error.message);
    return null;
  }
  return (data?.value as T) ?? null;
}

async function sbSet(key: string, value: unknown): Promise<void> {
  const sb = supabase();
  if (!sb) return;
  const { error } = await sb.from("itw_kv").upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) console.error("supabase set", key, error.message);
}

async function getJSON<T>(key: string): Promise<T | null> {
  if (supabaseConfigured()) return sbGet<T>(key);
  const r = redis();
  if (r) return ((await r.get(key)) as T) ?? null;
  const v = mem().json.get(key);
  return v === undefined ? null : (structuredClone(v) as T);
}

async function setJSON(key: string, value: unknown): Promise<void> {
  if (supabaseConfigured()) {
    await sbSet(key, value);
    return;
  }
  const r = redis();
  if (r) {
    await r.set(key, value);
    return;
  }
  mem().json.set(key, structuredClone(value));
  markDirty();
}

async function mgetJSON<T>(keys: string[]): Promise<(T | null)[]> {
  if (keys.length === 0) return [];
  if (supabaseConfigured()) {
    const sb = supabase()!;
    const { data, error } = await sb
      .from("itw_kv")
      .select("key, value")
      .in("key", keys);
    if (error) {
      console.error("supabase mget", error.message);
      return keys.map(() => null);
    }
    const map = new Map(
      (data ?? []).map((row) => [row.key as string, row.value])
    );
    return keys.map((k) => (map.has(k) ? (map.get(k) as T) : null));
  }
  const r = redis();
  if (r) {
    const out = (await r.mget(...keys)) as (T | null)[];
    return out.map((v) => v ?? null);
  }
  return keys.map((k) => {
    const v = mem().json.get(k);
    return v === undefined ? null : (structuredClone(v) as T);
  });
}

async function sAdd(key: string, member: string): Promise<void> {
  if (supabaseConfigured()) {
    const cur = (await sbGet<string[]>(key)) ?? [];
    if (!cur.includes(member)) {
      await sbSet(key, [...cur, member]);
    }
    return;
  }
  const r = redis();
  if (r) {
    await r.sadd(key, member);
    return;
  }
  const s = mem().sets.get(key) ?? new Set<string>();
  s.add(member);
  mem().sets.set(key, s);
  markDirty();
}

async function sMembers(key: string): Promise<string[]> {
  if (supabaseConfigured()) return (await sbGet<string[]>(key)) ?? [];
  const r = redis();
  if (r) return ((await r.smembers(key)) as string[]) ?? [];
  return Array.from(mem().sets.get(key) ?? []);
}

async function hGet(key: string, field: string): Promise<string | null> {
  if (supabaseConfigured()) {
    const h = (await sbGet<Record<string, string>>(key)) ?? {};
    return h[field] ?? null;
  }
  const r = redis();
  if (r) return ((await r.hget(key, field)) as string) ?? null;
  return mem().hashes.get(key)?.get(field) ?? null;
}

async function hSet(key: string, field: string, value: string): Promise<void> {
  if (supabaseConfigured()) {
    const h = (await sbGet<Record<string, string>>(key)) ?? {};
    h[field] = value;
    await sbSet(key, h);
    return;
  }
  const r = redis();
  if (r) {
    await r.hset(key, { [field]: value });
    return;
  }
  const h = mem().hashes.get(key) ?? new Map<string, string>();
  h.set(field, value);
  mem().hashes.set(key, h);
  markDirty();
}

async function hDel(key: string, field: string): Promise<void> {
  if (supabaseConfigured()) {
    const h = (await sbGet<Record<string, string>>(key)) ?? {};
    if (!(field in h)) return;
    delete h[field];
    await sbSet(key, h);
    return;
  }
  const r = redis();
  if (r) {
    await r.hdel(key, field);
    return;
  }
  mem().hashes.get(key)?.delete(field);
  markDirty();
}

async function sRem(key: string, member: string): Promise<void> {
  if (supabaseConfigured()) {
    const cur = (await sbGet<string[]>(key)) ?? [];
    const next = cur.filter((m) => m !== member);
    if (next.length === cur.length) return;
    await sbSet(key, next);
    return;
  }
  const r = redis();
  if (r) {
    await r.srem(key, member);
    return;
  }
  mem().sets.get(key)?.delete(member);
  markDirty();
}

async function delKey(key: string): Promise<void> {
  if (supabaseConfigured()) {
    const sb = supabase();
    if (!sb) return;
    const { error } = await sb.from("itw_kv").delete().eq("key", key);
    if (error) console.error("supabase del", key, error.message);
    return;
  }
  const r = redis();
  if (r) {
    await r.del(key);
    return;
  }
  mem().json.delete(key);
  mem().sets.delete(key);
  mem().hashes.delete(key);
  mem().lists.delete(key);
  markDirty();
}

async function lPushTrim(key: string, value: string, max: number): Promise<void> {
  if (supabaseConfigured()) {
    const l = (await sbGet<string[]>(key)) ?? [];
    await sbSet(key, [value, ...l].slice(0, max));
    return;
  }
  const r = redis();
  if (r) {
    await r.lpush(key, value);
    await r.ltrim(key, 0, max - 1);
    return;
  }
  const l = mem().lists.get(key) ?? [];
  l.unshift(value);
  mem().lists.set(key, l.slice(0, max));
  markDirty();
}

async function lRangeAll(key: string, max: number): Promise<string[]> {
  if (supabaseConfigured()) {
    return ((await sbGet<string[]>(key)) ?? []).slice(0, max);
  }
  const r = redis();
  if (r) return ((await r.lrange(key, 0, max - 1)) as string[]) ?? [];
  return (mem().lists.get(key) ?? []).slice(0, max);
}

/** Atomic set-if-absent — the sector claim lock */
async function setNX(key: string, value: string): Promise<boolean> {
  if (supabaseConfigured()) {
    const sb = supabase()!;
    const { error } = await sb.from("itw_kv").insert({
      key,
      value,
      updated_at: new Date().toISOString(),
    });
    if (!error) return true;
    // Unique violation = already claimed
    if (error.code === "23505") return false;
    console.error("supabase setNX", key, error.message);
    return false;
  }
  const r = redis();
  if (r) {
    const res = await r.set(key, value, { nx: true });
    return res === "OK";
  }
  if (mem().json.has(key)) return false;
  mem().json.set(key, value);
  markDirty();
  return true;
}

async function keyExists(key: string): Promise<boolean> {
  if (supabaseConfigured()) {
    const v = await sbGet(key);
    return v !== null;
  }
  const r = redis();
  if (r) return (await r.exists(key)) === 1;
  return mem().json.has(key);
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

type LegacyArmyFields = {
  soldiers?: number;
  tanks?: number;
  peakSoldiers?: number;
  peakTanks?: number;
};

function normalizePlayer(raw: Player): Player {
  const legacy = raw as Player & LegacyArmyFields;
  const p = { ...raw } as Player & LegacyArmyFields;
  if (p.lastRoamSpawnAt == null) p.lastRoamSpawnAt = 0;
  if (p.lastAttackAt == null) p.lastAttackAt = 0;
  if (p.lastRazeAt == null) p.lastRazeAt = 0;
  // Migrate soldiers/tanks → rockets (preserve old attack power: 1 + 3)
  if (p.rockets == null) {
    const soldiers = legacy.soldiers || 0;
    const tanks = legacy.tanks || 0;
    p.rockets = soldiers + tanks * 3;
  }
  if (p.peakRockets == null) {
    const peakS = legacy.peakSoldiers ?? legacy.soldiers ?? 0;
    const peakT = legacy.peakTanks ?? legacy.tanks ?? 0;
    p.peakRockets = Math.max(p.rockets, peakS + peakT * 3);
  }
  p.rockets = Math.max(0, p.rockets || 0);
  p.peakRockets = Math.max(p.peakRockets || 0, p.rockets);
  delete p.soldiers;
  delete p.tanks;
  delete p.peakSoldiers;
  delete p.peakTanks;
  if (p.totalFarmed == null) p.totalFarmed = p.gold || 0;
  if (p.villagerPost === undefined) p.villagerPost = null;
  if (!Array.isArray(p.reviewedPlaceIds)) p.reviewedPlaceIds = [];
  if (!p.color) p.color = colorForPlayerId(p.id);
  // Clamp building HP to the simplified scale (migrates old 100+ HP values)
  p.buildings = (p.buildings || []).map((b) => {
    const max = catalogItem(b.type).hp;
    const hp = b.hp ?? max;
    return {
      ...b,
      hp: Math.min(hp, max),
      level: buildingLevel(b),
    };
  });
  if (p.house) {
    if (p.fortified == null) p.fortified = false;
    const max = houseMaxHp(p);
    const hp = p.houseHp == null ? max : p.houseHp;
    p.houseHp = Math.max(0, Math.min(max, hp));
    if (p.houseHp <= 0) {
      p.house = null;
      p.houseHp = 0;
      p.fortified = false;
    }
  } else {
    p.houseHp = 0;
    p.fortified = false;
  }
  return p;
}

function normalizeSpot(s: ResourceSpot): ResourceSpot {
  const gem: GemType =
    s.kind === "easy"
      ? s.gem === "wood" || s.gem === "stone"
        ? s.gem
        : s.id.endsWith("_easy_0")
          ? "wood"
          : "stone"
      : s.gem && s.gem in GEM_META
        ? s.gem
        : "emerald";
  return {
    ...s,
    gem,
    yield: s.kind === "easy" ? GEM_META[gem].yield : s.yield || GEM_META[gem].yield,
    refillMs: s.kind === "easy" ? 0 : (s.refillMs ?? GEM_META[gem].refillMs),
  };
}

/* ------------------------------------------------------------------ */
/* Entity accessors                                                    */
/* ------------------------------------------------------------------ */

function normalizeSector(s: Sector): Sector {
  const code = (s.code?.trim() || s.name?.trim() || "Sector").slice(0, 32);
  const tag = s.tag?.trim() ? s.tag.trim().slice(0, 28) : undefined;
  const name = tag ? `${code} ${tag}` : code;
  return {
    ...s,
    code,
    tag,
    name,
    taggedBy: s.taggedBy,
    taggedAt: s.taggedAt,
  };
}

export async function getSectors(): Promise<Sector[]> {
  await bootstrap();
  const raw = (await getJSON<Sector[]>(K_SECTORS)) ?? [];
  return raw.map(normalizeSector);
}

export async function saveSectors(sectors: Sector[]): Promise<void> {
  await bootstrap();
  // Never allow an empty editor save to wipe the map
  if (sectors.length === 0) {
    const existing = (await getJSON<Sector[]>(K_SECTORS)) ?? [];
    if (existing.length > 0) {
      throw new Error(
        "Refusing to save 0 sectors — reload the editor and try again"
      );
    }
  }
  await setJSON(K_SECTORS, sectors.map(normalizeSector));
  const ids = new Set(sectors.map((s) => s.id));
  const spots = await getSpots();
  await setSpots(spots.filter((s) => ids.has(s.sectorId)));
  // Sector edits must never be lost — write through immediately
  await flushStore();
}

async function getSpots(): Promise<ResourceSpot[]> {
  const raw = (await getJSON<ResourceSpot[]>(K_SPOTS)) ?? [];
  return raw
    .map(normalizeSpot)
    .filter((s) => s.kind === "easy" || Boolean(s.ownerId));
}

async function setSpots(spots: ResourceSpot[]): Promise<void> {
  await setJSON(K_SPOTS, spots);
}

async function getWorldNpcs(): Promise<WorldNpc[]> {
  const raw = (await getJSON<WorldNpc[]>(K_WORLD_NPCS)) ?? [];
  return Array.isArray(raw) ? raw : [];
}

async function setWorldNpcs(npcs: WorldNpc[]): Promise<void> {
  await setJSON(K_WORLD_NPCS, npcs);
}

async function getPlayer(id: string): Promise<Player | null> {
  const raw = await getJSON<Player>(kPlayer(id));
  return raw ? normalizePlayer(raw) : null;
}

async function setPlayer(p: Player): Promise<void> {
  await setJSON(kPlayer(p.id), p);
  await sAdd(K_PIDS, p.id);
}

async function getAllPlayers(): Promise<Player[]> {
  const ids = await sMembers(K_PIDS);
  if (ids.length === 0) return [];
  const raws = await mgetJSON<Player>(ids.map(kPlayer));
  return raws.filter(Boolean).map((p) => normalizePlayer(p as Player));
}

async function pushEvent(e: GameEvent): Promise<void> {
  await lPushTrim(K_EVENTS, JSON.stringify(e), 120);
}

async function recentEvents(): Promise<GameEvent[]> {
  const raw = await lRangeAll(K_EVENTS, 120);
  const parsed: GameEvent[] = [];
  for (const item of raw) {
    try {
      parsed.push(
        typeof item === "string" ? JSON.parse(item) : (item as GameEvent)
      );
    } catch {
      /* skip malformed */
    }
  }
  return parsed.reverse(); // chronological
}

async function getSectorHistory(): Promise<Record<string, SectorStatsPoint[]>> {
  const raw = await getJSON<Record<string, SectorStatsPoint[]>>(K_SECTOR_HISTORY);
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, SectorStatsPoint[]> = {};
  for (const [id, pts] of Object.entries(raw)) {
    if (!Array.isArray(pts)) continue;
    out[id] = pts
      .filter((p) => p && typeof p.ts === "number")
      .sort((a, b) => a.ts - b.ts)
      .slice(-SECTOR_HISTORY_MAX_POINTS);
  }
  return out;
}

/**
 * Append hourly economy samples for mapped sectors.
 * Seeds a zero-baseline at the earliest settler's createdAt when empty.
 */
async function recordSectorHistories(
  sectors: Sector[],
  players: Player[],
  spots: ResourceSpot[]
): Promise<Record<string, SectorStatsPoint[]>> {
  const now = Date.now();
  // Polls every ~4s — don't re-read/write history every time.
  // Serve the isolate cache until the hourly sample window approaches.
  const checkedAt = g.__itwSectorHistAt ?? 0;
  if (
    g.__itwSectorHistCache &&
    now - checkedAt < Math.min(5 * 60_000, SECTOR_HISTORY_INTERVAL_MS / 2)
  ) {
    return g.__itwSectorHistCache;
  }

  const hist = await getSectorHistory();
  let changed = false;

  for (const sector of sectors) {
    if (isAzadHomeId(sector.id)) continue;
    const settlers = players.filter((p) => p.homeSectorId === sector.id);
    const spotCount = spots.filter((s) => s.sectorId === sector.id).length;
    const live = sectorPointFromPlayers(settlers, sector.id, spotCount, now);
    const series = [...(hist[sector.id] ?? [])].sort((a, b) => a.ts - b.ts);

    if (series.length === 0 && settlers.length > 0) {
      const firstJoin = Math.min(...settlers.map((p) => p.createdAt || now));
      if (firstJoin < now - 60_000) {
        series.push({
          ts: firstJoin,
          settlers: 1,
          farmed: 0,
          gold: 0,
          villagers: 1,
          buildings: 0,
          rockets: 0,
          spots: Math.max(1, spotCount),
        });
        changed = true;
      }
    }

    const last = series[series.length - 1];
    const due =
      !last ||
      now - last.ts >= SECTOR_HISTORY_INTERVAL_MS ||
      (last.settlers !== live.settlers && now - last.ts >= 5 * 60_000);
    if (due) {
      series.push(live);
      changed = true;
    }

    hist[sector.id] = series.slice(-SECTOR_HISTORY_MAX_POINTS);
  }

  if (changed) await setJSON(K_SECTOR_HISTORY, hist);
  g.__itwSectorHistAt = now;
  g.__itwSectorHistCache = hist;
  return hist;
}

export function makeInviteCode(seed: string): string {
  const base = seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base || "ITW"}${rand}`.slice(0, 8);
}

/* ------------------------------------------------------------------ */
/* Bootstrap: migrate the old blob once, seed sectors if empty           */
/* ------------------------------------------------------------------ */

let bootPromise: Promise<void> | null = null;

async function bootstrap(): Promise<void> {
  // Fresh lambdas (and stale caches) pull durable state first
  await hydrateFromBlob();
  if (!bootPromise) bootPromise = doBootstrap();
  await bootPromise;
}

type LegacyState = {
  sectors?: Sector[];
  spots?: ResourceSpot[];
  players?: Record<string, Player>;
  invites?: Record<string, string>;
  events?: GameEvent[];
};

/** One-time copy from Vercel Blob → Supabase when the new DB is empty */
async function migrateBlobToSupabase(): Promise<void> {
  if (!supabaseConfigured() || !blobToken()) return;
  const flag = `${P}:supabase_migrated`;
  if (await keyExists(flag)) return;
  // Only migrate if Supabase has no sectors yet
  const existing = await sbGet<Sector[]>(K_SECTORS);
  if (existing && existing.length > 0) {
    await sbSet(flag, Date.now());
    return;
  }
  const remote = await fetchRemoteState();
  if (remote) {
    for (const [k, v] of Object.entries(remote.json ?? {})) {
      await sbSet(k, v);
    }
    for (const [k, v] of Object.entries(remote.sets ?? {})) {
      await sbSet(k, v);
    }
    for (const [k, v] of Object.entries(remote.hashes ?? {})) {
      await sbSet(k, v);
    }
    for (const [k, v] of Object.entries(remote.lists ?? {})) {
      await sbSet(k, v);
    }
    console.log("Migrated Blob game state → Supabase");
  }
  await sbSet(flag, Date.now());
}

async function doBootstrap(): Promise<void> {
  await migrateBlobToSupabase();
  const migrated = await keyExists(K_MIGRATED);
  if (!migrated) {
    const legacy = await getJSON<LegacyState>(LEGACY_BLOB_KEY);
    if (legacy && typeof legacy === "object") {
      if (Array.isArray(legacy.sectors) && legacy.sectors.length) {
        await setJSON(K_SECTORS, legacy.sectors);
      }
      if (Array.isArray(legacy.spots)) {
        await setJSON(K_SPOTS, legacy.spots);
      }
      for (const p of Object.values(legacy.players ?? {})) {
        await setPlayer(normalizePlayer(p));
        if (p.homeSectorId) {
          await setNX(kOwner(p.homeSectorId), p.id);
        }
        if (p.inviteCode) {
          await hSet(K_INVITES, p.inviteCode, p.id);
        }
      }
      for (const [code, pid] of Object.entries(legacy.invites ?? {})) {
        await hSet(K_INVITES, code, pid);
      }
      for (const e of (legacy.events ?? []).slice(-50)) {
        await pushEvent(e);
      }
    }
    await setJSON(K_MIGRATED, Date.now());
  }

  const sectors = (await getJSON<Sector[]>(K_SECTORS)) ?? [];
  if (sectors.length === 0) {
    await setJSON(K_SECTORS, buildDummySectors());
  }
}

/** Drop the old dummy E-7 enemy sector + Rival Garrison bot if still present */
async function removeDummyEnemySector(): Promise<void> {
  // Avoid 2+ storage round-trips on every poll once the world is clean
  if (g.__itwDummyPurged) return;

  const sectors = (await getJSON<Sector[]>(K_SECTORS)) ?? [];
  const hasSector = sectors.some((s) => s.id === DUMMY_ENEMY_SECTOR_ID);
  const bot = await getPlayer(BOT_ID);
  if (!hasSector && !bot) {
    g.__itwDummyPurged = true;
    return;
  }

  if (hasSector) {
    await setJSON(
      K_SECTORS,
      sectors.filter((s) => s.id !== DUMMY_ENEMY_SECTOR_ID)
    );
  }

  const spots = await getSpots();
  const nextSpots = spots.filter((s) => s.sectorId !== DUMMY_ENEMY_SECTOR_ID);
  if (nextSpots.length !== spots.length) {
    await setSpots(nextSpots);
  }

  if (bot) {
    await sRem(K_PIDS, BOT_ID);
    await delKey(kPlayer(BOT_ID));
  }

  // Unsettle any non-bot player still parked on the deleted dummy sector
  const players = await getAllPlayers();
  const now = Date.now();
  for (const p of players) {
    if (p.homeSectorId !== DUMMY_ENEMY_SECTOR_ID) continue;
    await setPlayer({
      ...p,
      homeSectorId: null,
      house: null,
      houseHp: 0,
      villagerPost: null,
      buildings: [],
      updatedAt: now,
    });
  }

  await hDel(K_INVITES, "RIVAL0");
  await delKey(kOwner(DUMMY_ENEMY_SECTOR_ID));
  await flushStore();
  g.__itwDummyPurged = true;
}

/* ------------------------------------------------------------------ */
/* Accrual                                                             */
/* ------------------------------------------------------------------ */

/** Accrue one player's pending gather trips. Persists when asked. */
async function accruePlayer(
  p: Player,
  spots: ResourceSpot[],
  persist: boolean
): Promise<{ player: Player; spots: ResourceSpot[]; spotsChanged: boolean }> {
  const now = Date.now();
  const before = JSON.stringify(spots.map((s) => s.availableAt));
  const { players, spots: nextSpots, changed } = accrueGather(
    { [p.id]: p },
    spots,
    now
  );
  const next = players[p.id]!;
  const spotsChanged =
    before !== JSON.stringify(nextSpots.map((s) => s.availableAt));
  if (persist && changed) {
    await setPlayer(next);
    if (spotsChanged) await setSpots(nextSpots);
  }
  return { player: next, spots: nextSpots, spotsChanged };
}

/** Display-only projection — never writes */
function projectPlayer(p: Player, spots: ResourceSpot[]): Player {
  const { players } = accrueGather({ [p.id]: p }, spots, Date.now());
  return players[p.id]!;
}

function publicPlayer(p: Player): PublicPlayer {
  // Always expose a walk origin so rival villagers render even if post was never set
  const villagerPost =
    p.villagerPost ?? (p.house ? { lat: p.house.lat, lng: p.house.lng } : null);
  return {
    id: p.id,
    name: p.name,
    color: p.color || colorForPlayerId(p.id),
    homeSectorId: p.homeSectorId,
    house: p.house,
    houseHp: p.houseHp ?? 0,
    fortified: Boolean(p.fortified && p.house),
    villagerPost,
    villagers: p.villagers,
    rockets: p.rockets || 0,
    peakRockets: Math.max(p.peakRockets || 0, p.rockets || 0),
    gold: p.gold,
    totalFarmed: p.totalFarmed || 0,
    buildings: p.buildings,
    discoveredSpotIds: p.discoveredSpotIds,
    createdAt: p.createdAt || 0,
    updatedAt: p.updatedAt || p.createdAt || 0,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function ensurePlayer(
  id: string,
  name: string,
  email?: string,
  image?: string | null,
  inviteCodeFromClient?: string | null
): Promise<Player> {
  await bootstrap();
  let me = await getPlayer(id);
  const now = Date.now();

  if (!me) {
    let inviteCode = makeInviteCode(name || id);
    while (await hGet(K_INVITES, inviteCode)) {
      inviteCode = makeInviteCode(id + Math.random());
    }

    let invitedBy: string | null = null;
    const ref = inviteCodeFromClient?.trim().toUpperCase();
    if (ref) {
      const ownerId = await hGet(K_INVITES, ref);
      if (ownerId && ownerId !== id) {
        const inviter = await getPlayer(ownerId);
        if (inviter) {
          invitedBy = ownerId;
          // Referral reward: inviter gains a permanent villager
          await setPlayer({
            ...inviter,
            villagers: (inviter.villagers || 0) + INVITE_VILLAGER_BONUS,
            updatedAt: now,
          });
        }
      }
    }

    me = {
      id,
      name: name || "Settler",
      email,
      image: image ?? null,
      color: colorForPlayerId(id),
      homeSectorId: null,
      house: null,
      houseHp: 0,
      villagerPost: null,
      // Invitees still start at 0 until settle; inviter already got +1
      villagers: 0,
      rockets: 0,
      peakRockets: 0,
      gold: STARTING.gold,
      totalFarmed: 0,
      buildings: [],
      discoveredSpotIds: [],
      reviewedPlaceIds: [],
      inviteCode,
      invitedBy,
      lastGatherAt: now,
      lastRoamSpawnAt: 0,
      lastAttackAt: 0,
      lastRazeAt: 0,
      createdAt: now,
      updatedAt: now,
    };
    await setPlayer(me);
    await hSet(K_INVITES, inviteCode, id);
    return me;
  }

  // Backfill color for accounts created before the field existed
  if (!me.color) {
    me = { ...me, color: colorForPlayerId(me.id), updatedAt: now };
    await setPlayer(me);
  }

  // Backfill invite codes so Share / Invite always has a working link
  if (!me.inviteCode) {
    let inviteCode = makeInviteCode(me.name || me.id);
    while (await hGet(K_INVITES, inviteCode)) {
      inviteCode = makeInviteCode(me.id + Math.random());
    }
    me = { ...me, inviteCode, updatedAt: now };
    await setPlayer(me);
    await hSet(K_INVITES, inviteCode, id);
    if (!g.__itwInviteSyncAt) g.__itwInviteSyncAt = new Map();
    g.__itwInviteSyncAt.set(id, now);
  } else {
    // Keep the invite index in sync — but not on every 4s poll
    if (!g.__itwInviteSyncAt) g.__itwInviteSyncAt = new Map();
    const lastSync = g.__itwInviteSyncAt.get(id) ?? 0;
    if (now - lastSync > 5 * 60_000) {
      const mapped = await hGet(K_INVITES, me.inviteCode);
      if (mapped !== id) {
        await hSet(K_INVITES, me.inviteCode, id);
      }
      g.__itwInviteSyncAt.set(id, now);
    }
  }

  if ((name && name !== me.name) || image !== undefined) {
    // Guest names are derived from the id — don't clobber custom renames
    const nextName = me.name?.startsWith("Settler ") && name ? name : me.name;
    const next = {
      ...me,
      name: nextName,
      image: image !== undefined ? image : me.image,
    };
    if (JSON.stringify(next) !== JSON.stringify(me)) {
      await setPlayer(next);
      me = next;
    }
  }

  // Accrual happens in getSnapshot — avoid a second getSpots + write on every poll
  return me;
}

export async function getSnapshot(
  meId?: string | null,
  opts?: { email?: string | null; includeHistory?: boolean }
): Promise<GameSnapshot> {
  const includeHistory = opts?.includeHistory !== false;
  await bootstrap();
  await removeDummyEnemySector();

  // One parallel storage wave instead of chained getSectors→bootstrap→reads
  const [sectors, spotsAll, playersAll, allEvents, tutorialFlag, worldNpcsRaw] =
    await Promise.all([
      getJSON<Sector[]>(K_SECTORS).then((v) => v ?? []),
      getSpots(),
      getAllPlayers(),
      recentEvents(),
      meId ? hGet(K_TUTORIAL_BACKUP, meId) : Promise.resolve(null),
      getWorldNpcs(),
    ]);

  let me = meId ? playersAll.find((p) => p.id === meId) ?? null : null;
  let spotsWorking = spotsAll;
  if (me) {
    const accrued = await accruePlayer(me, spotsWorking, true);
    me = accrued.player;
    if (accrued.spotsChanged) spotsWorking = accrued.spots;
  }

  // Advance CDA trucks / spy sat drains before projecting players
  let playersWorking = playersAll.map((p) =>
    p.id === me?.id && me ? me : p
  );
  const ticked = tickWorldNpcs({
    npcs: worldNpcsRaw,
    players: playersWorking,
  });
  const worldNpcs = ticked.npcs;
  if (ticked.dirtyPlayers.length > 0 || worldNpcsRaw !== worldNpcs) {
    const dirtyIds = new Set(ticked.dirtyPlayers.map((p) => p.id));
    for (const dp of ticked.dirtyPlayers) {
      await setPlayer(dp);
      playersWorking = playersWorking.map((p) => (p.id === dp.id ? dp : p));
      if (me && me.id === dp.id) me = dp;
    }
    // Always persist if npc list changed length/phases
    const npcChanged =
      JSON.stringify(worldNpcsRaw.map((n) => n.id + n.phase + n.lat)) !==
      JSON.stringify(worldNpcs.map((n) => n.id + n.phase + n.lat));
    if (npcChanged || dirtyIds.size > 0) {
      await setWorldNpcs(worldNpcs);
    }
  }

  const players = playersWorking.map((p) =>
    p.id === me?.id && me
      ? publicPlayer(me)
      : publicPlayer(projectPlayer(p, spotsWorking))
  );

  // Ensure every settled home has easy nodes so rival walk loops have a target
  const settled = playersWorking.filter((p) => p.homeSectorId && p.house);
  let seeded = false;
  for (const p of settled) {
    if (!p.house || !p.homeSectorId) continue;
    if (isAzadHomeId(p.homeSectorId)) {
      if (
        !spotsWorking.some((s) => s.sectorId === p.homeSectorId && s.kind === "easy")
      ) {
        spotsWorking = seedSpotsForAzad(p.homeSectorId, p.house, spotsWorking);
        seeded = true;
      }
      continue;
    }
    const sector = sectors.find((s) => s.id === p.homeSectorId);
    if (!sector) continue;
    if (!spotsWorking.some((s) => s.sectorId === sector.id && s.kind === "easy")) {
      spotsWorking = seedSpotsForSector(sector, p.house, spotsWorking);
      seeded = true;
    }
  }
  if (seeded) await setSpots(spotsWorking);

  // Easy nodes + contested claimable finds are world-visible;
  // legacy refillable hiddens stay private to discoverers/owners.
  const spots = spotsWorking.filter((s) => {
    if (s.kind === "easy") return true;
    if (s.claimable) return true;
    if (!me) return false;
    return s.ownerId === me.id || me.discoveredSpotIds.includes(s.id);
  });

  const events = me
    ? allEvents
        .filter((e) => e.attackerId === me!.id || e.defenderId === me!.id)
        .slice(-30)
    : [];
  const globalEvents = allEvents.slice(-40);

  // History is for analytics — don't block every poll on a storage read
  const sectorHistory = includeHistory
    ? await recordSectorHistories(sectors, playersWorking, spotsWorking)
    : g.__itwSectorHistCache ?? {};

  // Persist any accrual/seed/bootstrap writes made during this request
  await flushStore();

  const inviteCount = meId
    ? playersWorking.filter((p) => p.invitedBy === meId).length
    : 0;

  const flexUnlocked = me
    ? canUnlockFlexVehicles(me, playersWorking)
    : false;

  const activeSpyThreats = me
    ? worldNpcs.filter(
        (n) => isSpySat(n) && n.targetPlayerId === me!.id
      )
    : [];
  const activeRaidTruck =
    me
      ? worldNpcs.find(
          (n) =>
            isCdaTruck(n) &&
            n.targetPlayerId === me!.id &&
            (n.phase === "parked" || n.phase === "traveling")
        ) ?? null
      : null;

  return {
    sectors,
    spots,
    players,
    me,
    events,
    globalEvents,
    sectorHistory,
    worldNpcs,
    activeSpyThreats,
    activeRaidTruck,
    serverNow: Date.now(),
    gatherTripMs: GATHER_TRIP_MS,
    buildingCatalog: flexUnlocked
      ? BUILDING_CATALOG
      : BUILDING_CATALOG.filter((b) => !isFlexVehicle(b.type)),
    authDisabled: AUTH_DISABLED,
    isAdmin: isAdminEmail(opts?.email ?? me?.email),
    storageBackend: storageBackend(),
    inviteCount,
    tutorialTestActive: Boolean(tutorialFlag),
  };
}

async function wipePlayerSettlement(me: Player): Promise<Player> {
  const now = Date.now();
  const next: Player = {
    ...me,
    homeSectorId: null,
    house: null,
    houseHp: 0,
    villagerPost: null,
    villagers: 0,
    rockets: 0,
    peakRockets: 0,
    gold: STARTING.gold,
    totalFarmed: 0,
    buildings: [],
    discoveredSpotIds: [],
    reviewedPlaceIds: [],
    lastGatherAt: now,
    lastRoamSpawnAt: 0,
    lastAttackAt: 0,
    lastRazeAt: 0,
    updatedAt: now,
  };
  await setPlayer(next);

  // Drop gems / finds owned by this player so the map is clean
  const spots = await getSpots();
  const kept = spots.filter((s) => s.ownerId !== me.id);
  if (kept.length !== spots.length) {
    await setSpots(kept);
  }
  return next;
}

/**
 * Hard-reset the current player's settlement so they can re-run
 * location / GPS setup from a blank slate. Keeps name + invite code.
 */
export async function resetPlayerProgress(
  playerId: string
): Promise<{ ok: true } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me) return { error: "Player missing" };
  await wipePlayerSettlement(me);
  await hDel(K_TUTORIAL_BACKUP, playerId);
  await flushStore();
  return { ok: true };
}

/**
 * Back up the current player and reset them to a fresh unsettled account
 * so the settle / villager tutorial can be tested end-to-end.
 */
export async function beginTutorialTest(
  playerId: string
): Promise<{ ok: true } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me) return { error: "Player missing" };

  // Keep the first backup if already testing (re-run fresh settle)
  const existing = await hGet(K_TUTORIAL_BACKUP, playerId);
  if (!existing) {
    await hSet(K_TUTORIAL_BACKUP, playerId, JSON.stringify(me));
  }

  await wipePlayerSettlement(me);
  await flushStore();
  return { ok: true };
}

/** Restore the player saved by beginTutorialTest. */
export async function endTutorialTest(
  playerId: string
): Promise<{ ok: true } | { error: string }> {
  await bootstrap();
  const raw = await hGet(K_TUTORIAL_BACKUP, playerId);
  if (!raw) return { error: "No tutorial test in progress" };

  let backup: Player;
  try {
    backup = JSON.parse(raw) as Player;
  } catch {
    await hDel(K_TUTORIAL_BACKUP, playerId);
    return { error: "Tutorial backup was corrupt — cleared" };
  }

  await setPlayer({
    ...backup,
    updatedAt: Date.now(),
  });
  await hDel(K_TUTORIAL_BACKUP, playerId);
  await flushStore();
  return { ok: true };
}

async function assertClearGround(
  playerId: string,
  house: { lat: number; lng: number }
): Promise<{ error: string } | null> {
  const everyone = await getAllPlayers();
  for (const p of everyone) {
    if (p.id === playerId) continue;
    for (const b of p.buildings) {
      if (
        distMeters(house, { lat: b.lat, lng: b.lng }) <
        HOUSE_FOOTPRINT_M + catalogItem(b.type).footprintM
      ) {
        return { error: "That ground is occupied — pick a clear spot" };
      }
    }
    if (p.house && distMeters(house, p.house) < HOUSE_FOOTPRINT_M * 2) {
      return { error: "Too close to another house" };
    }
  }
  return null;
}

export async function claimSector(
  playerId: string,
  sectorId: string,
  housePos?: { lat: number; lng: number },
  villagerPos?: { lat: number; lng: number },
  gpsPos?: { lat: number; lng: number }
): Promise<{ ok: true } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me) return { error: "Player missing" };
  if (me.homeSectorId) {
    return { error: "You already settled in a sector." };
  }
  const sectors = await getSectors();
  const sector = sectors.find((s) => s.id === sectorId);
  if (!sector) return { error: "Sector not found" };

  // Many players may settle the same sector — no exclusive lock.

  if (
    !gpsPos ||
    !Number.isFinite(gpsPos.lat) ||
    !Number.isFinite(gpsPos.lng)
  ) {
    return { error: "Confirm your GPS location inside the sector first" };
  }
  if (!pointInOrNearRing(gpsPos, sector.ring, 120)) {
    return {
      error: `Your GPS is outside ${sector.name} — go there to settle`,
    };
  }

  const house =
    housePos && Number.isFinite(housePos.lat) && Number.isFinite(housePos.lng)
      ? housePos
      : ringCentroid(sector.ring);
  if (!pointInRing(house, sector.ring)) {
    return { error: "Place your base inside the sector" };
  }

  const blocked = await assertClearGround(playerId, house);
  if (blocked) return blocked;

  let villagerPost: { lat: number; lng: number } | null = null;
  if (
    villagerPos &&
    Number.isFinite(villagerPos.lat) &&
    Number.isFinite(villagerPos.lng)
  ) {
    if (!pointInRing(villagerPos, sector.ring)) {
      return { error: "Place your villager inside the sector" };
    }
    if (distMeters(villagerPos, house) > 400) {
      return { error: "Villager must stay near the base (within 400m)" };
    }
    villagerPost = villagerPos;
  }

  // Soft residency marker (not exclusive) — useful for bots / legacy
  await setNX(kOwner(sectorId), playerId);

  const now = Date.now();
  const spots = seedSpotsForSector(sector, house, await getSpots());
  await setSpots(spots);

  const easyIds = spots
    .filter((s) => s.sectorId === sectorId && s.kind === "easy")
    .map((s) => s.id);

  await setPlayer({
    ...me,
    homeSectorId: sectorId,
    house,
    houseHp: HOUSE_MAX_HP,
    fortified: false,
    villagerPost,
    // Keep referral villagers earned before settling
    villagers: Math.max(STARTING.villagers, me.villagers || 0),
    rockets: 0,
    peakRockets: 0,
    gold: STARTING.gold,
    totalFarmed: 0,
    buildings: [],
    discoveredSpotIds: easyIds,
    lastGatherAt: now,
    lastRoamSpawnAt: 0,
    lastAttackAt: 0,
    lastRazeAt: 0,
    updatedAt: now,
  });

  // Write through immediately so a concurrent poll can't lose the settle
  await flushStore();
  return { ok: true };
}

/**
 * Settle into Azad Umeed Wars — for players whose GPS isn't inside any
 * Islamabad sector. No map walls; play radius is around the house.
 */
export async function claimAzadUmeed(
  playerId: string,
  housePos: { lat: number; lng: number },
  villagerPos?: { lat: number; lng: number },
  gpsPos?: { lat: number; lng: number }
): Promise<{ ok: true } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me) return { error: "Player missing" };
  if (me.homeSectorId) {
    return { error: "You already settled." };
  }
  if (
    !gpsPos ||
    !Number.isFinite(gpsPos.lat) ||
    !Number.isFinite(gpsPos.lng)
  ) {
    return { error: "Confirm your GPS location first" };
  }
  if (!Number.isFinite(housePos.lat) || !Number.isFinite(housePos.lng)) {
    return { error: "Place your house on the map" };
  }
  // House should be near the confirmed pin
  if (distMeters(housePos, gpsPos) > AZAD_PLAY_RADIUS_M) {
    return { error: "Place your house near your GPS pin" };
  }

  const blocked = await assertClearGround(playerId, housePos);
  if (blocked) return blocked;

  let villagerPost: { lat: number; lng: number } | null = null;
  if (
    villagerPos &&
    Number.isFinite(villagerPos.lat) &&
    Number.isFinite(villagerPos.lng)
  ) {
    if (distMeters(villagerPos, housePos) > 400) {
      return { error: "Villager must stay near the base (within 400m)" };
    }
    villagerPost = villagerPos;
  }

  const homeId = azadHomeIdFor(playerId);
  const now = Date.now();
  const spots = seedSpotsForAzad(homeId, housePos, await getSpots());
  await setSpots(spots);
  const easyIds = spots
    .filter((s) => s.sectorId === homeId && s.kind === "easy")
    .map((s) => s.id);

  await setPlayer({
    ...me,
    homeSectorId: homeId,
    house: housePos,
    houseHp: HOUSE_MAX_HP,
    fortified: false,
    villagerPost: villagerPost ?? housePos,
    villagers: Math.max(STARTING.villagers, me.villagers || 0),
    rockets: 0,
    peakRockets: 0,
    gold: STARTING.gold,
    totalFarmed: 0,
    buildings: [],
    discoveredSpotIds: easyIds,
    lastGatherAt: now,
    lastRoamSpawnAt: 0,
    lastAttackAt: 0,
    lastRazeAt: 0,
    updatedAt: now,
  });
  await flushStore();
  return { ok: true };
}

/** Rebuild house after it was destroyed in battle (keeps the same sector). */
export async function placeHouse(
  playerId: string,
  housePos: { lat: number; lng: number },
  villagerPos?: { lat: number; lng: number }
): Promise<{ ok: true } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId) return { error: "Settle in a sector first" };
  if (me.house) return { error: "You already have a base" };

  const azad = isAzadHomeId(me.homeSectorId);
  const sectors = await getSectors();
  const sector = azad
    ? null
    : sectors.find((s) => s.id === me.homeSectorId);
  if (!azad && !sector) return { error: "Sector missing" };

  if (!Number.isFinite(housePos.lat) || !Number.isFinite(housePos.lng)) {
    return { error: "Pick a spot for your base" };
  }
  if (azad) {
    // Rebuild near previous villager post or freely nearby
  } else if (sector && !pointInRing(housePos, sector.ring)) {
    return { error: "Place your base inside your sector" };
  }

  const blocked = await assertClearGround(playerId, housePos);
  if (blocked) return blocked;

  let villagerPost = me.villagerPost;
  if (
    villagerPos &&
    Number.isFinite(villagerPos.lat) &&
    Number.isFinite(villagerPos.lng)
  ) {
    if (!azad && sector && !pointInRing(villagerPos, sector.ring)) {
      return { error: "Place your villager inside the sector" };
    }
    if (distMeters(villagerPos, housePos) > 400) {
      return { error: "Villager must stay near the base (within 400m)" };
    }
    villagerPost = villagerPos;
  } else if (
    villagerPost &&
    distMeters(villagerPost, housePos) > 400
  ) {
    villagerPost = housePos;
  }

  const now = Date.now();
  await setPlayer({
    ...me,
    house: housePos,
    houseHp: HOUSE_MAX_HP,
    fortified: false,
    villagerPost: villagerPost ?? housePos,
    lastGatherAt: now,
    updatedAt: now,
  });
  await flushStore();
  return { ok: true };
}

export async function spawnRoamFind(
  playerId: string,
  opts: {
    lat: number;
    lng: number;
    bearing: number;
    zoom: number;
    roamMeters: number;
    exploreMs: number;
  }
): Promise<
  | { ok: true; gem: GemType; spotId: string }
  | { error: string }
> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId || !me.house) return { error: "Settle in a sector first" };
  if (opts.zoom < EXPLORE_ZOOM) {
    return { error: "Zoom all the way in to explore" };
  }
  if ((opts.roamMeters || 0) < ROAM_METERS_TO_SPAWN) {
    return { error: "Keep roaming…" };
  }
  if ((opts.exploreMs || 0) < ROAM_MIN_EXPLORE_MS) {
    return { error: "Explore a bit longer…" };
  }

  const azad = isAzadHomeId(me.homeSectorId);
  const sectors = await getSectors();
  const sector = azad
    ? null
    : sectors.find((s) => s.id === me.homeSectorId);
  if (!azad && !sector) return { error: "Home sector missing" };
  if (azad && !me.house) return { error: "Place your house first" };

  const view = { lat: opts.lat, lng: opts.lng };
  const inTerritory = azad
    ? distMeters(view, me.house!) <= AZAD_PLAY_RADIUS_M
    : pointInRing(view, sector!.ring);
  if (!inTerritory) {
    return {
      error: azad
        ? "Roam near your house to find resources"
        : "Roam inside your own sector",
    };
  }

  const now = Date.now();
  if (me.lastRoamSpawnAt && now - me.lastRoamSpawnAt < SPAWN_COOLDOWN_MS) {
    return { error: "Keep exploring…" };
  }

  const spots = await getSpots();
  const finds = spots.filter(
    (s) =>
      s.sectorId === me.homeSectorId &&
      s.kind === "hidden" &&
      s.claimable &&
      s.ownerId === playerId
  );
  if (finds.length >= MAX_ROAM_FINDS) {
    return { error: "You've found every vein around here for now" };
  }

  const inBounds = (p: { lat: number; lng: number }) =>
    azad
      ? distMeters(p, me.house!) <= AZAD_PLAY_RADIUS_M
      : pointInRing(p, sector!.ring);

  // Spawn close to the camera so finds are easy to notice and tap
  const ahead = 12 + Math.random() * 18;
  let pos = offsetBearing(view, opts.bearing, ahead);
  pos = offsetBearing(pos, opts.bearing + 90, (Math.random() - 0.5) * 16);

  if (!inBounds(pos)) {
    pos = offsetBearing(view, opts.bearing, 14);
  }
  if (!inBounds(pos)) {
    pos = offsetBearing(view, opts.bearing + 90, 12);
  }
  if (!inBounds(pos)) {
    return {
      error: azad
        ? "Stay closer to your house and keep roaming"
        : "Edge of the sector — turn back and keep roaming",
    };
  }

  const tooClose = spots.some(
    (s) =>
      s.sectorId === me.homeSectorId &&
      distMeters(pos, { lat: s.lat, lng: s.lng }) < 14
  );
  if (tooClose) {
    pos = offsetBearing(view, opts.bearing + 55, 16);
    if (
      !inBounds(pos) ||
      spots.some(
        (s) =>
          s.sectorId === me.homeSectorId &&
          distMeters(pos, { lat: s.lat, lng: s.lng }) < 12
      )
    ) {
      return { error: "Keep roaming a bit further" };
    }
  }

  const gem = pickRoamGem();
  const meta = GEM_META[gem];
  const spotId = `find_${playerId.slice(-4)}_${now.toString(36)}`;
  const spot: ResourceSpot = {
    id: spotId,
    sectorId: me.homeSectorId,
    kind: "hidden",
    gem,
    lat: pos.lat,
    lng: pos.lng,
    yield: meta.yield * 2,
    refillMs: 0,
    availableAt: 0,
    ownerId: playerId,
    claimable: true,
  };

  // No gold yet — first player to tap the gem claims it
  await setSpots([...spots, spot]);
  await setPlayer({
    ...me,
    lastRoamSpawnAt: now,
    updatedAt: now,
  });
  return { ok: true, gem, spotId };
}

export async function discoverSpot(
  playerId: string,
  spotId: string
): Promise<{ ok: true; bonus?: number } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId) return { error: "Settle in a sector first" };
  const spots = await getSpots();
  const spot = spots.find((s) => s.id === spotId);
  if (!spot) return { error: "Spot not found" };
  if (spot.sectorId !== me.homeSectorId) {
    return { error: "That spot is outside your sector" };
  }
  if (me.discoveredSpotIds.includes(spotId)) {
    return { error: "Already discovered" };
  }
  if (spot.kind !== "hidden") {
    return { error: "Easy spots are already known" };
  }

  const bonus = spot.yield * 2;
  const now = Date.now();
  await setPlayer({
    ...me,
    discoveredSpotIds: [...me.discoveredSpotIds, spotId],
    gold: me.gold + bonus,
    totalFarmed: (me.totalFarmed || 0) + bonus,
    updatedAt: now,
  });
  await setSpots(
    spots.map((s) =>
      s.id === spotId ? { ...s, availableAt: now + (s.refillMs || 45_000) } : s
    )
  );
  return { ok: true, bonus };
}

/**
 * Claim a contested roam find (world-visible, first tap wins)
 * or harvest a legacy private refillable hidden cache.
 */
export async function collectHidden(
  playerId: string,
  spotId: string
): Promise<
  | {
      ok: true;
      gained?: number;
      gem?: GemType;
      stolen?: boolean;
      ownerName?: string;
    }
  | { error: string }
> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId) return { error: "Settle in a sector first" };

  const spots = await getSpots();
  const spot = spots.find((s) => s.id === spotId);
  if (!spot || spot.kind !== "hidden") return { error: "Not a resource find" };
  const now = Date.now();

  // Contested one-shot — anyone settled can claim
  if (spot.claimable) {
    if (spot.availableAt > now) {
      return { error: "Already claimed" };
    }
    const gained = spot.yield;
    const ownerId = spot.ownerId;
    const stolen = Boolean(ownerId && ownerId !== playerId);
    const sectors = await getSectors();
    const spotSector = sectors.find((s) => s.id === spot.sectorId);
    const claimerSector = isAzadHomeId(me.homeSectorId)
      ? null
      : sectors.find((s) => s.id === me.homeSectorId);
    const owner = ownerId ? await getPlayer(ownerId) : null;

    await setPlayer({
      ...me,
      gold: me.gold + gained,
      totalFarmed: (me.totalFarmed || 0) + gained,
      discoveredSpotIds: me.discoveredSpotIds.includes(spotId)
        ? me.discoveredSpotIds
        : [...me.discoveredSpotIds, spotId],
      updatedAt: now,
    });
    // Remove from the map — first claim wins
    await setSpots(spots.filter((s) => s.id !== spotId));

    if (stolen && owner) {
      await pushEvent({
        type: "gem_claim",
        id: `gem_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        ts: now,
        attackerId: me.id,
        attackerName: me.name,
        defenderId: owner.id,
        defenderName: owner.name,
        sectorId: spot.sectorId,
        sectorName: spotSector?.name ?? "Sector",
        gem: spot.gem,
        gold: gained,
        claimerSectorName: isAzadHomeId(me.homeSectorId)
          ? AZAD_ARENA_NAME
          : claimerSector?.name ?? "Sector",
      });
    }

    return {
      ok: true,
      gained,
      gem: spot.gem,
      stolen,
      ownerName: stolen ? owner?.name : undefined,
    };
  }

  // Legacy private cache — claim is instant, no refill cooldown
  if (!me.discoveredSpotIds.includes(spotId)) {
    return { error: "Explore and discover this spot first" };
  }
  if (spot.sectorId !== me.homeSectorId) return { error: "Wrong sector" };

  await setPlayer({
    ...me,
    gold: me.gold + spot.yield,
    totalFarmed: (me.totalFarmed || 0) + spot.yield,
    updatedAt: now,
  });
  // Remove on claim (same as contested finds) — no wait-to-refill
  await setSpots(spots.filter((s) => s.id !== spotId));
  return { ok: true, gained: spot.yield, gem: spot.gem };
}

export async function renamePlayer(
  playerId: string,
  name: string
): Promise<{ ok: true } | { error: string }> {
  const trimmed = name.trim().slice(0, 24);
  if (trimmed.length < 2) return { error: "Name too short" };
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me) return { error: "Player missing" };
  await setPlayer({ ...me, name: trimmed, updatedAt: Date.now() });
  return { ok: true };
}

/**
 * Top scorer in a mapped sector may set a custom tag.
 * Display becomes `${code} ${tag}` (e.g. "H8 Empire").
 */
export async function renameSectorTag(
  playerId: string,
  sectorId: string,
  tagRaw: string
): Promise<{ ok: true; name: string } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId) return { error: "Settle in a sector first" };
  if (isAzadHomeId(me.homeSectorId)) {
    return { error: "Azad Umeed sectors can't be renamed" };
  }
  if (me.homeSectorId !== sectorId) {
    return { error: "You can only rename your home sector" };
  }

  const tag = tagRaw.trim().replace(/\s+/g, " ").slice(0, 28);
  if (tag.length > 0 && tag.length < 2) {
    return { error: "Tag too short — use at least 2 characters" };
  }
  if (tag && !/^[A-Za-z0-9][A-Za-z0-9 '\-.]{0,27}$/.test(tag)) {
    return { error: "Use letters, numbers, spaces, or - ' ." };
  }

  const sectors = await getSectors();
  const idx = sectors.findIndex((s) => s.id === sectorId);
  if (idx < 0) return { error: "Sector missing" };
  const sector = sectors[idx]!;

  // Must be #1 by totalFarmed inside this sector
  const players = await getAllPlayers();
  if (topScorerIdForHome(players, sectorId) !== playerId) {
    return { error: "Only the top scorer in this sector can rename it" };
  }

  const code = (sector.code?.trim() || sector.name.trim()).slice(0, 32);
  const now = Date.now();
  const next: Sector = normalizeSector({
    ...sector,
    code,
    tag: tag || undefined,
    taggedBy: tag ? playerId : undefined,
    taggedAt: tag ? now : undefined,
    updatedAt: now,
  });
  const nextSectors = [...sectors];
  nextSectors[idx] = next;
  await setJSON(K_SECTORS, nextSectors);
  await flushStore();
  return { ok: true, name: next.name };
}

/**
 * Reward +1 villager for reviewing a local business on Google Maps.
 * Honor-system claim — one reward per place key, must be inside home sector.
 */
export async function claimBusinessReview(
  playerId: string,
  input: {
    placeKey: string;
    name: string;
    lat: number;
    lng: number;
  }
): Promise<{ ok: true; bonus: number } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId || !me.house) {
    return { error: "Settle and place your house first" };
  }

  const placeKey = input.placeKey.trim().slice(0, 120);
  const name = input.name.trim().slice(0, 80);
  if (!placeKey || name.length < 2) return { error: "Invalid business" };
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
    return { error: "Invalid location" };
  }

  const azad = isAzadHomeId(me.homeSectorId);
  if (azad) {
    if (
      distMeters({ lat: input.lat, lng: input.lng }, me.house) >
      AZAD_PLAY_RADIUS_M
    ) {
      return { error: "That business is too far from your village" };
    }
  } else {
    const sectors = await getSectors();
    const sector = sectors.find((s) => s.id === me.homeSectorId);
    if (!sector) return { error: "Sector missing" };
    if (
      !pointInOrNearRing({ lat: input.lat, lng: input.lng }, sector.ring, 120)
    ) {
      return { error: "That business is outside your sector" };
    }
  }

  const reviewed = me.reviewedPlaceIds || [];
  if (reviewed.includes(placeKey)) {
    return { error: "You already claimed a villager for this place" };
  }

  const now = Date.now();
  await setPlayer({
    ...me,
    villagers: (me.villagers || 0) + REVIEW_VILLAGER_BONUS,
    reviewedPlaceIds: [...reviewed, placeKey],
    updatedAt: now,
  });
  await flushStore();
  return { ok: true, bonus: REVIEW_VILLAGER_BONUS };
}

export async function buildBuilding(
  playerId: string,
  type: BuildingType,
  lat?: number,
  lng?: number
): Promise<{ ok: true } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId || !me.house) return { error: "Settle in a sector first" };
  const cat = BUILDING_CATALOG.find((b) => b.type === type);
  if (!cat) return { error: "Unknown building" };

  const azad = isAzadHomeId(me.homeSectorId);
  const [sectors, everyone, spots] = await Promise.all([
    getSectors(),
    getAllPlayers(),
    getSpots(),
  ]);
  const sector = azad
    ? null
    : sectors.find((s) => s.id === me.homeSectorId);
  if (!azad && !sector) return { error: "Sector missing" };
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { error: "Tap a spot near your village to place it" };
  }

  if (isFlexVehicle(type) && !canUnlockFlexVehicles(me, everyone)) {
    return { error: "Only the top scorer in your sector can buy cars" };
  }

  const pos = { lat: lat!, lng: lng! };
  if (azad) {
    if (distMeters(pos, me.house) > AZAD_PLAY_RADIUS_M) {
      return { error: "Place it near your house" };
    }
  } else if (sector && !pointInRing(pos, sector.ring)) {
    return { error: "Place it inside your own sector" };
  }

  for (const p of everyone) {
    for (const b of p.buildings) {
      const otherFp = catalogItem(b.type).footprintM;
      if (distMeters(pos, { lat: b.lat, lng: b.lng }) < cat.footprintM + otherFp) {
        return {
          error:
            p.id === playerId
              ? "Too close to your other building"
              : `Too close to ${p.name}'s building`,
        };
      }
    }
    if (p.house) {
      if (distMeters(pos, p.house) < cat.footprintM + HOUSE_FOOTPRINT_M) {
        return {
          error:
            p.id === playerId
              ? "Too close to your house"
              : `Too close to ${p.name}'s house`,
        };
      }
    }
  }

  // Accrue pending gold first so affordability reflects reality
  const { player: fresh } = await accruePlayer(me, spots, true);
  if (fresh.gold < cat.cost) return { error: `Need ${formatGold(cat.cost)} gold` };

  const now = Date.now();
  await setPlayer({
    ...fresh,
    gold: fresh.gold - cat.cost,
    buildings: [
      ...fresh.buildings,
      {
        id: `b_${now.toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        type,
        lat: pos.lat,
        lng: pos.lng,
        hp: cat.hp,
        builtAt: now,
        level: 1,
      },
    ],
    updatedAt: now,
  });
  return { ok: true };
}

/** Remove one of your own buildings (no refund). */
export async function demolishBuilding(
  playerId: string,
  buildingId: string
): Promise<{ ok: true } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId) return { error: "Settle first" };
  if (!buildingId) return { error: "Missing building" };
  const target = me.buildings.find((b) => b.id === buildingId);
  if (!target) return { error: "Building not found" };

  const now = Date.now();
  await setPlayer({
    ...me,
    buildings: me.buildings.filter((b) => b.id !== buildingId),
    updatedAt: now,
  });
  return { ok: true };
}

/**
 * Upgrade your building to level 2 (×2 output) for 10× catalog price.
 * Already-upgraded buildings cannot be upgraded again.
 */
export async function upgradeBuilding(
  playerId: string,
  buildingId: string
): Promise<{ ok: true; level: number } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId) return { error: "Settle first" };
  if (!me.house) return { error: "Rebuild your base first" };
  if (!buildingId) return { error: "Missing building" };

  const target = me.buildings.find((b) => b.id === buildingId);
  if (!target) return { error: "Building not found" };
  if ((target.hp ?? 0) <= 0) return { error: "That building is destroyed" };

  const level = buildingLevel(target);
  if (level >= BUILDING_MAX_LEVEL) {
    return { error: "Already upgraded to ×2" };
  }

  const cost = buildingUpgradeCost(target.type);
  const spots = await getSpots();
  const { player: fresh } = await accruePlayer(me, spots, true);
  if (fresh.gold < cost) {
    return { error: `Need ${formatGold(cost)} gold to upgrade` };
  }

  const now = Date.now();
  const nextLevel = BUILDING_MAX_LEVEL;
  await setPlayer({
    ...fresh,
    gold: fresh.gold - cost,
    buildings: fresh.buildings.map((b) =>
      b.id === buildingId ? { ...b, level: nextLevel } : b
    ),
    updatedAt: now,
  });
  return { ok: true, level: nextLevel };
}

/** Manual dig — each click on your shovel grants gold (×2 if upgraded). */
export async function clickShovel(
  playerId: string,
  buildingId: string
): Promise<
  | { ok: true; gold: number; totalFarmed: number; gained: number }
  | { error: string }
> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId) return { error: "Settle first" };
  if (!me.house) return { error: "Rebuild your base first" };
  if (!buildingId) return { error: "Missing shovel" };

  const shovel = me.buildings.find(
    (b) => b.id === buildingId && b.type === "shovel"
  );
  if (!shovel) return { error: "Shovel missing — place one near your base" };
  if ((shovel.hp ?? 0) <= 0) return { error: "That shovel is destroyed" };

  const gained = shovelDigYield(shovel);

  // Soft rate limit (~25 taps/sec) — still feels instant for humans
  const now = Date.now();
  const last = me.lastShovelClickAt;
  if (typeof last === "number" && now - last < 40) {
    return {
      ok: true,
      gold: me.gold,
      totalFarmed: me.totalFarmed || 0,
      gained: 0,
    };
  }

  const spots = await getSpots();
  const { player: fresh } = await accruePlayer(me, spots, true);
  const nextGold = fresh.gold + gained;
  const nextFarmed = (fresh.totalFarmed || 0) + gained;
  await setPlayer({
    ...fresh,
    gold: nextGold,
    totalFarmed: nextFarmed,
    lastShovelClickAt: now,
    updatedAt: now,
  });

  return { ok: true, gold: nextGold, totalFarmed: nextFarmed, gained };
}

export async function buyRocket(
  playerId: string
): Promise<{ ok: true } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId) return { error: "Settle in a sector first" };
  if (!me.house) return { error: "Rebuild your base before stocking rockets" };
  const spots = await getSpots();
  const { player: fresh } = await accruePlayer(me, spots, true);
  if (fresh.gold < ROCKET_COST) {
    return { error: `Need ◈${ROCKET_COST} gold to buy a rocket` };
  }
  const rockets = (fresh.rockets || 0) + 1;
  await setPlayer({
    ...fresh,
    gold: fresh.gold - ROCKET_COST,
    rockets,
    peakRockets: Math.max(fresh.peakRockets || 0, rockets),
    updatedAt: Date.now(),
  });
  return { ok: true };
}

/** Raise circular stone walls around the base — more HP + defense. */
export async function fortifyBase(
  playerId: string
): Promise<{ ok: true } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId) return { error: "Settle in a sector first" };
  if (!me.house) return { error: "Rebuild your base before raising walls" };
  if (me.fortified) return { error: "Your base already has walls" };
  const spots = await getSpots();
  const { player: fresh } = await accruePlayer(me, spots, true);
  if (fresh.gold < BASE_WALL_COST) {
    return { error: `Need ◈${BASE_WALL_COST} gold for fortress walls` };
  }
  const now = Date.now();
  await setPlayer({
    ...fresh,
    gold: fresh.gold - BASE_WALL_COST,
    fortified: true,
    houseHp: FORTIFIED_HOUSE_MAX_HP,
    updatedAt: now,
  });
  return { ok: true };
}

/** Admin: place / move the CDA Head Office on the map. */
export async function adminPlaceCdaHq(
  adminId: string,
  pos: { lat: number; lng: number }
): Promise<{ ok: true } | { error: string }> {
  await bootstrap();
  if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) {
    return { error: "Pick a map spot for CDA Head Office" };
  }
  const npcs = await getWorldNpcs();
  const next = placeCdaHqAt(npcs, pos, adminId);
  await setWorldNpcs(next);
  await flushStore();
  return { ok: true };
}

/** Force-dispatch a CDA raid truck (admin / testing). */
export async function adminDispatchCdaTruck(): Promise<
  { ok: true; targetName?: string } | { error: string }
> {
  await bootstrap();
  const npcs = await getWorldNpcs();
  const players = await getAllPlayers();
  const result = forceDispatchCdaTruck(npcs, players, Date.now());
  if ("error" in result) return result;
  await setWorldNpcs(result.npcs);
  await flushStore();
  return { ok: true, targetName: result.truck.targetName ?? undefined };
}

export async function plantSpySatellite(
  playerId: string,
  lat: number,
  lng: number
): Promise<{ ok: true } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me) return { error: "Sign in first" };
  const spots = await getSpots();
  const { player: fresh } = await accruePlayer(me, spots, true);
  const sectors = await getSectors();
  const players = await getAllPlayers();
  const npcs = await getWorldNpcs();
  const result = plantSpySat({
    npcs,
    planter: fresh,
    sectors,
    players,
    lat,
    lng,
  });
  if ("error" in result) return result;
  await setPlayer(result.planter);
  await setWorldNpcs(result.npcs);
  await flushStore();
  return { ok: true };
}

export async function smashSpySatellite(
  playerId: string,
  npcId: string
): Promise<{ ok: true } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me) return { error: "Sign in first" };
  const npcs = await getWorldNpcs();
  const result = destroySpySat({ npcs, actor: me, npcId });
  if ("error" in result) return result;
  await setWorldNpcs(result.npcs.filter((n) => n.phase !== "gone"));
  await flushStore();
  return { ok: true };
}

export async function chaseCdaRaidTruck(
  playerId: string,
  npcId: string,
  actorPos?: { lat: number; lng: number } | null
): Promise<{ ok: true; message?: string } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me) return { error: "Sign in first" };
  const npcs = await getWorldNpcs();
  const result = chaseRaidTruck({
    npcs,
    actor: me,
    npcId,
    actorPos,
  });
  if ("error" in result) return result;
  await setWorldNpcs(result.npcs.filter((n) => n.phase !== "gone"));
  await flushStore();
  return { ok: true, message: result.message };
}

/**
 * Same-sector sabotage: rocket a neighbor's building to free ground.
 * House cannot be cleared this way — only placed buildings.
 */
export async function razeBuilding(
  playerId: string,
  targetPlayerId: string,
  buildingId: string,
  rocketsToFire?: number
): Promise<
  | {
      ok: true;
      raze: {
        buildingType: BuildingType;
        buildingName: string;
        sectorId: string;
        sectorName: string;
        defenderName: string;
        rocketsLost: number;
        damage: number;
        destroyed: boolean;
        buildingHp: number;
      };
    }
  | { error: string }
> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId || !me.house) {
    return { error: "Settle and place your house first" };
  }
  if (!targetPlayerId || targetPlayerId === playerId) {
    return { error: "Pick someone else's building" };
  }
  if (!buildingId) return { error: "Pick a building to clear" };

  const stock = me.rockets || 0;
  if (stock <= 0) {
    return { error: "Buy rockets for your arsenal before clearing ground" };
  }

  const now = Date.now();
  // Same arsenal reload as cross-sector raids
  if (me.lastAttackAt && now - me.lastAttackAt < ATTACK_COOLDOWN_MS) {
    const wait = Math.ceil(
      (ATTACK_COOLDOWN_MS - (now - me.lastAttackAt)) / 1000
    );
    return { error: `Reloading arsenal — ${wait}s until next strike` };
  }

  const owner = await getPlayer(targetPlayerId);
  if (!owner?.homeSectorId) {
    return { error: "That settler has no village" };
  }
  if (owner.homeSectorId !== me.homeSectorId) {
    return {
      error:
        "Only buildings in your sector can be cleared this way — raid other sectors with rockets",
    };
  }

  const building = owner.buildings.find((b) => b.id === buildingId);
  if (!building) return { error: "That building is already gone" };

  const fired = Math.max(
    1,
    Math.min(stock, Math.floor(Number(rocketsToFire) || stock))
  );
  const damage = attackPower(fired);
  const nextHp = Math.max(0, (building.hp || 0) - damage);
  const destroyed = nextHp <= 0;
  const buildingName = catalogItem(building.type).name;
  const nextBuildings = destroyed
    ? owner.buildings.filter((b) => b.id !== buildingId)
    : owner.buildings.map((b) =>
        b.id === buildingId ? { ...b, hp: nextHp } : b
      );
  const sectors = await getSectors();
  const sector = sectors.find((s) => s.id === me.homeSectorId);
  const sectorName = isAzadHomeId(me.homeSectorId)
    ? AZAD_ARENA_NAME
    : sector?.name ?? me.homeSectorId ?? "Sector";

  await setPlayer({
    ...owner,
    buildings: nextBuildings,
    updatedAt: now,
  });
  await setPlayer({
    ...me,
    rockets: stock - fired,
    lastAttackAt: now,
    lastRazeAt: now,
    updatedAt: now,
  });

  await pushEvent({
    id: `rz_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    ts: now,
    type: "raze",
    attackerId: playerId,
    attackerName: me.name,
    defenderId: owner.id,
    defenderName: owner.name,
    sectorId: me.homeSectorId,
    sectorName,
    buildingId: building.id,
    buildingType: building.type,
    buildingName,
    rocketsLost: fired,
    damage,
    destroyed,
  });

  await flushStore();
  return {
    ok: true,
    raze: {
      buildingType: building.type,
      buildingName,
      sectorId: me.homeSectorId,
      sectorName,
      defenderName: owner.name,
      rocketsLost: fired,
      damage,
      destroyed,
      buildingHp: nextHp,
    },
  };
}

export async function attackSector(
  playerId: string,
  targetPlayerId: string,
  rocketsToFire?: number
): Promise<{ ok: true; battle: BattleReport } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId) return { error: "Settle in a sector first" };
  if (!me.house) {
    return { error: "Rebuild your base before attacking" };
  }
  const stock = me.rockets || 0;
  if (stock <= 0) {
    return { error: "Buy rockets for your arsenal before attacking" };
  }
  if (!targetPlayerId || targetPlayerId === playerId) {
    return { error: "Pick someone else to attack" };
  }
  const now = Date.now();
  if (me.lastAttackAt && now - me.lastAttackAt < ATTACK_COOLDOWN_MS) {
    const wait = Math.ceil((ATTACK_COOLDOWN_MS - (now - me.lastAttackAt)) / 1000);
    return { error: `Reloading arsenal — ${wait}s until next attack` };
  }

  const defender = await getPlayer(targetPlayerId);
  if (!defender?.homeSectorId) {
    return { error: "That settler has no village" };
  }
  if (defender.homeSectorId === me.homeSectorId) {
    return { error: "Can't attack settlers in your own sector" };
  }
  const targetSectorId = defender.homeSectorId;

  // Fire a chosen salvo — those rockets are always expended
  const fired = Math.max(
    1,
    Math.min(stock, Math.floor(Number(rocketsToFire) || stock))
  );
  const atk = attackPower(fired);
  const def = defensePower(defender);
  const win = atk > def;

  // 1 attack point = 1 HP. Losing raids still chip for half (min 1).
  const damageBudget = win ? atk : Math.max(1, Math.floor(atk / 2));
  let remaining = damageBudget;
  const destroyedNames: string[] = [];
  const damagedNames: string[] = [];

  // Newer buildings first, house last
  const targets = [...defender.buildings].sort(
    (a, b) => b.builtAt - a.builtAt
  );
  const survivingBuildings = targets
    .map((b) => {
      if (remaining <= 0) return b;
      const dmg = Math.min(b.hp, remaining);
      remaining -= dmg;
      const hp = b.hp - dmg;
      if (hp <= 0) {
        destroyedNames.push(catalogItem(b.type).name);
        return null;
      }
      if (dmg > 0) damagedNames.push(catalogItem(b.type).name);
      return { ...b, hp };
    })
    .filter(Boolean) as Building[];

  let nextHouse = defender.house;
  let nextHouseHp = defender.houseHp ?? 0;
  let houseDestroyed = false;
  let houseDamaged = false;
  if (remaining > 0 && nextHouse && nextHouseHp > 0) {
    const dmg = Math.min(nextHouseHp, remaining);
    remaining -= dmg;
    nextHouseHp -= dmg;
    if (dmg > 0) houseDamaged = true;
    if (nextHouseHp <= 0) {
      houseDestroyed = true;
      houseDamaged = false;
      nextHouse = null;
      nextHouseHp = 0;
      destroyedNames.push("Base");
    }
  }

  const damageDealt = damageBudget - remaining;

  const rocketsLost = fired;
  let defenderRocketsLost: number;
  let lootedGold = 0;

  if (win) {
    defenderRocketsLost = Math.min(
      defender.rockets || 0,
      Math.floor(fired / 2) || 1
    );
    if (survivingBuildings.length === 0 || houseDestroyed) {
      lootedGold = Math.min(defender.gold, 25);
    }
  } else {
    defenderRocketsLost = Math.min(
      defender.rockets || 0,
      Math.max(1, Math.floor(fired / 3))
    );
  }

  await setPlayer({
    ...defender,
    house: nextHouse,
    houseHp: nextHouseHp,
    fortified: houseDestroyed ? false : defender.fortified,
    // Gathering pauses without a house — reset anchor so rebuild isn't back-paid
    lastGatherAt: houseDestroyed ? now : defender.lastGatherAt,
    buildings: survivingBuildings,
    rockets: Math.max(0, (defender.rockets || 0) - defenderRocketsLost),
    gold: defender.gold - lootedGold,
    lastAttackAt: now,
    updatedAt: now,
  });

  await setPlayer({
    ...me,
    rockets: Math.max(0, (me.rockets || 0) - rocketsLost),
    gold: me.gold + lootedGold,
    lastAttackAt: now,
    updatedAt: now,
  });

  const destroyed = destroyedNames.length ? destroyedNames.join(", ") : null;
  const sectors = await getSectors();
  const sector = sectors.find((s) => s.id === targetSectorId);

  // Notify the defender by email (no-op unless RESEND_API_KEY is set)
  if (defender.email) {
    await sendAttackEmail({
      toEmail: defender.email,
      defenderName: defender.name,
      attackerName: me.name,
      sectorName: sector?.name ?? targetSectorId,
      win,
      damage: damageDealt,
      destroyed,
      houseDestroyed,
      lootedGold,
    });
  }

  await pushEvent({
    id: `ev_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    ts: now,
    type: "attack",
    attackerId: playerId,
    attackerName: me.name,
    defenderId: defender.id,
    defenderName: defender.name,
    sectorId: targetSectorId,
    sectorName: isAzadHomeId(targetSectorId)
      ? AZAD_ARENA_NAME
      : sector?.name ?? targetSectorId,
    attackerSectorId: me.homeSectorId ?? undefined,
    win,
    damage: damageDealt,
    destroyed,
    lootedGold,
    defenderRocketsLost,
    attackPower: atk,
    defensePower: def,
    rocketsLost,
    damagedBuildings: damagedNames,
    houseDestroyed,
    houseDamaged,
  });

  return {
    ok: true,
    battle: {
      win,
      attackPower: atk,
      defensePower: def,
      damage: damageDealt,
      destroyed,
      damagedBuildings: damagedNames,
      houseDestroyed,
      houseDamaged,
      lootedGold,
      rocketsLost,
      defenderRocketsLost,
    },
  };
}


export { buildingBonus };
