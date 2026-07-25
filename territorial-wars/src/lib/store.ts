import { Redis } from "@upstash/redis";
import {
  ATTACK_COOLDOWN_MS,
  BUILDING_CATALOG,
  EXPLORE_ZOOM,
  GATHER_TRIP_MS,
  GEM_META,
  HOUSE_FOOTPRINT_M,
  HOUSE_MAX_HP,
  INVITE_VILLAGER_BONUS,
  MAX_ROAM_FINDS,
  ROAM_METERS_TO_SPAWN,
  ROAM_MIN_EXPLORE_MS,
  SOLDIER_COST,
  SPAWN_COOLDOWN_MS,
  STARTING,
  TANK_COST,
  attackPower,
  buildingBonus,
  catalogItem,
  defensePower,
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
} from "@/lib/gameTypes";
import { AUTH_DISABLED, buildDummySectors } from "@/lib/devMode";
import { pointInOrNearRing, pointInRing } from "@/lib/geo";
import {
  distMeters,
  offsetBearing,
  offsetMeters,
  pickRoamGem,
  ringCentroid,
  seedSpotsForSector,
} from "@/lib/mapMath";
import { accrueGather } from "@/lib/rules";

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
 */

const P = "itw:v3";
const K_SECTORS = `${P}:sectors`;
const K_SPOTS = `${P}:spots`;
const K_PIDS = `${P}:pids`;
const K_INVITES = `${P}:invites`;
const K_EVENTS = `${P}:events`;
const K_MIGRATED = `${P}:migrated`;
const kPlayer = (id: string) => `${P}:p:${id}`;
const kOwner = (sid: string) => `${P}:owner:${sid}`;

const LEGACY_BLOB_KEY = "itw:v2:state";

const BOT_ID = "bot_garrison";
const BOT_SECTOR_ID = "sec_e7";
const BOT_RESTOCK_MS = 3 * 60_000;

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/* ------------------------------------------------------------------ */
/* In-memory fallback (local dev without Redis)                        */
/* ------------------------------------------------------------------ */

type MemStore = {
  json: Map<string, unknown>;
  sets: Map<string, Set<string>>;
  hashes: Map<string, Map<string, string>>;
  lists: Map<string, string[]>;
};

const g = globalThis as unknown as { __itwMem?: MemStore };
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

/* ------------------------------------------------------------------ */
/* Low-level ops                                                       */
/* ------------------------------------------------------------------ */

async function getJSON<T>(key: string): Promise<T | null> {
  const r = redis();
  if (r) return ((await r.get(key)) as T) ?? null;
  const v = mem().json.get(key);
  return v === undefined ? null : (structuredClone(v) as T);
}

async function setJSON(key: string, value: unknown): Promise<void> {
  const r = redis();
  if (r) {
    await r.set(key, value);
    return;
  }
  mem().json.set(key, structuredClone(value));
}

async function mgetJSON<T>(keys: string[]): Promise<(T | null)[]> {
  if (keys.length === 0) return [];
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
  const r = redis();
  if (r) {
    await r.sadd(key, member);
    return;
  }
  const s = mem().sets.get(key) ?? new Set<string>();
  s.add(member);
  mem().sets.set(key, s);
}

async function sMembers(key: string): Promise<string[]> {
  const r = redis();
  if (r) return ((await r.smembers(key)) as string[]) ?? [];
  return Array.from(mem().sets.get(key) ?? []);
}

async function hGet(key: string, field: string): Promise<string | null> {
  const r = redis();
  if (r) return ((await r.hget(key, field)) as string) ?? null;
  return mem().hashes.get(key)?.get(field) ?? null;
}

async function hSet(key: string, field: string, value: string): Promise<void> {
  const r = redis();
  if (r) {
    await r.hset(key, { [field]: value });
    return;
  }
  const h = mem().hashes.get(key) ?? new Map<string, string>();
  h.set(field, value);
  mem().hashes.set(key, h);
}

async function lPushTrim(key: string, value: string, max: number): Promise<void> {
  const r = redis();
  if (r) {
    await r.lpush(key, value);
    await r.ltrim(key, 0, max - 1);
    return;
  }
  const l = mem().lists.get(key) ?? [];
  l.unshift(value);
  mem().lists.set(key, l.slice(0, max));
}

async function lRangeAll(key: string, max: number): Promise<string[]> {
  const r = redis();
  if (r) return ((await r.lrange(key, 0, max - 1)) as string[]) ?? [];
  return (mem().lists.get(key) ?? []).slice(0, max);
}

/** Atomic set-if-absent — the sector claim lock */
async function setNX(key: string, value: string): Promise<boolean> {
  const r = redis();
  if (r) {
    const res = await r.set(key, value, { nx: true });
    return res === "OK";
  }
  if (mem().json.has(key)) return false;
  mem().json.set(key, value);
  return true;
}

async function getStr(key: string): Promise<string | null> {
  const r = redis();
  if (r) return ((await r.get(key)) as string) ?? null;
  const v = mem().json.get(key);
  return typeof v === "string" ? v : null;
}

async function keyExists(key: string): Promise<boolean> {
  const r = redis();
  if (r) return (await r.exists(key)) === 1;
  return mem().json.has(key);
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

function normalizePlayer(raw: Player): Player {
  const p = { ...raw };
  if (p.lastRoamSpawnAt == null) p.lastRoamSpawnAt = 0;
  if (p.lastAttackAt == null) p.lastAttackAt = 0;
  if (p.soldiers == null) p.soldiers = 0;
  if (p.tanks == null) p.tanks = 0;
  if (p.peakSoldiers == null) p.peakSoldiers = p.soldiers;
  if (p.peakTanks == null) p.peakTanks = p.tanks;
  if (p.totalFarmed == null) p.totalFarmed = p.gold || 0;
  if (p.villagerPost === undefined) p.villagerPost = null;
  // Clamp building HP to the simplified scale (migrates old 100+ HP values)
  p.buildings = (p.buildings || []).map((b) => {
    const max = catalogItem(b.type).hp;
    const hp = b.hp ?? max;
    return { ...b, hp: Math.min(hp, max) };
  });
  if (p.house) {
    const hp = p.houseHp == null ? HOUSE_MAX_HP : p.houseHp;
    p.houseHp = Math.max(0, Math.min(HOUSE_MAX_HP, hp));
    if (p.houseHp <= 0) {
      p.house = null;
      p.houseHp = 0;
    }
  } else {
    p.houseHp = 0;
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

export async function getSectors(): Promise<Sector[]> {
  await bootstrap();
  return (await getJSON<Sector[]>(K_SECTORS)) ?? [];
}

export async function saveSectors(sectors: Sector[]): Promise<void> {
  await bootstrap();
  await setJSON(K_SECTORS, sectors);
  const ids = new Set(sectors.map((s) => s.id));
  const spots = await getSpots();
  await setSpots(spots.filter((s) => ids.has(s.sectorId)));
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
  await lPushTrim(K_EVENTS, JSON.stringify(e), 50);
}

async function recentEvents(): Promise<GameEvent[]> {
  const raw = await lRangeAll(K_EVENTS, 50);
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

export function makeInviteCode(seed: string): string {
  const base = seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base || "ITW"}${rand}`.slice(0, 8);
}

/* ------------------------------------------------------------------ */
/* Bootstrap: migrate the old blob once, seed sectors, keep bot alive  */
/* ------------------------------------------------------------------ */

let bootPromise: Promise<void> | null = null;

async function bootstrap(): Promise<void> {
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

async function doBootstrap(): Promise<void> {
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

/** Bot-held practice sector: create + heal/restock a few minutes after raids */
async function ensureRivalGarrison(): Promise<void> {
  const sectors = (await getJSON<Sector[]>(K_SECTORS)) ?? [];
  let sector = sectors.find((s) => s.id === BOT_SECTOR_ID);
  if (!sector) {
    const seeded = buildDummySectors().find((s) => s.id === BOT_SECTOR_ID);
    if (!seeded) return;
    sector = seeded;
    await setJSON(K_SECTORS, [...sectors, sector]);
  }

  const now = Date.now();
  const center = ringCentroid(sector.ring);
  const defaultBuildings = (): Building[] => {
    const turretPos = offsetMeters(center, 65, 5);
    const millPos = offsetMeters(center, -80, -25);
    const warehousePos = offsetMeters(center, 15, 85);
    return [
      {
        id: "bot_b_turret",
        type: "turret",
        lat: turretPos.lat,
        lng: turretPos.lng,
        hp: catalogItem("turret").hp,
        builtAt: now,
      },
      {
        id: "bot_b_mill",
        type: "mill",
        lat: millPos.lat,
        lng: millPos.lng,
        hp: catalogItem("mill").hp,
        builtAt: now,
      },
      {
        id: "bot_b_warehouse",
        type: "warehouse",
        lat: warehousePos.lat,
        lng: warehousePos.lng,
        hp: catalogItem("warehouse").hp,
        builtAt: now,
      },
    ];
  };

  const bot = await getPlayer(BOT_ID);
  if (!bot) {
    await setPlayer({
      id: BOT_ID,
      name: "Rival Garrison",
      homeSectorId: BOT_SECTOR_ID,
      house: center,
      houseHp: HOUSE_MAX_HP,
      villagerPost: null,
      villagers: 1,
      soldiers: 1,
      tanks: 0,
      peakSoldiers: 1,
      peakTanks: 0,
      gold: 40,
      totalFarmed: 0,
      buildings: defaultBuildings(),
      discoveredSpotIds: [],
      inviteCode: "RIVAL0",
      invitedBy: null,
      lastGatherAt: now,
      lastRoamSpawnAt: now,
      lastAttackAt: 0,
      createdAt: now,
      updatedAt: now,
    });
    await hSet(K_INVITES, "RIVAL0", BOT_ID);
    await setNX(kOwner(BOT_SECTOR_ID), BOT_ID);
    return;
  }

  const razed =
    !bot.house ||
    (bot.houseHp || 0) < HOUSE_MAX_HP ||
    bot.buildings.length < 3 ||
    (bot.soldiers || 0) < 1 ||
    bot.buildings.some((b) => b.hp < catalogItem(b.type).hp);
  if (razed && now - (bot.lastAttackAt || 0) > BOT_RESTOCK_MS) {
    await setPlayer({
      ...bot,
      house: bot.house ?? center,
      houseHp: HOUSE_MAX_HP,
      soldiers: Math.max(bot.soldiers || 0, 1),
      buildings: defaultBuildings(),
      updatedAt: now,
    });
  }
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
  return {
    id: p.id,
    name: p.name,
    homeSectorId: p.homeSectorId,
    house: p.house,
    houseHp: p.houseHp ?? 0,
    villagerPost: p.villagerPost ?? null,
    villagers: p.villagers,
    soldiers: p.soldiers || 0,
    tanks: p.tanks || 0,
    peakSoldiers: Math.max(p.peakSoldiers || 0, p.soldiers || 0),
    peakTanks: Math.max(p.peakTanks || 0, p.tanks || 0),
    gold: p.gold,
    totalFarmed: p.totalFarmed || 0,
    buildings: p.buildings,
    discoveredSpotIds: p.discoveredSpotIds,
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
          await setPlayer({
            ...inviter,
            villagers: inviter.villagers + INVITE_VILLAGER_BONUS,
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
      homeSectorId: null,
      house: null,
      houseHp: 0,
      villagerPost: null,
      villagers: 0,
      soldiers: 0,
      tanks: 0,
      peakSoldiers: 0,
      peakTanks: 0,
      gold: STARTING.gold,
      totalFarmed: 0,
      buildings: [],
      discoveredSpotIds: [],
      inviteCode,
      invitedBy,
      lastGatherAt: now,
      lastRoamSpawnAt: 0,
      lastAttackAt: 0,
      createdAt: now,
      updatedAt: now,
    };
    await setPlayer(me);
    await hSet(K_INVITES, inviteCode, id);
    return me;
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

  const spots = await getSpots();
  const { player } = await accruePlayer(me, spots, true);
  return player;
}

export async function getSnapshot(meId?: string | null): Promise<GameSnapshot> {
  await bootstrap();
  await ensureRivalGarrison();

  const [sectors, spotsAll, playersAll] = await Promise.all([
    getSectors(),
    getSpots(),
    getAllPlayers(),
  ]);

  let me = meId ? playersAll.find((p) => p.id === meId) ?? null : null;
  if (me) {
    const { player } = await accruePlayer(me, spotsAll, true);
    me = player;
  }

  const players = playersAll.map((p) =>
    p.id === me?.id ? publicPlayer(me) : publicPlayer(projectPlayer(p, spotsAll))
  );

  // Easy nodes are shared/visible in every sector so you can see others gather
  const spots = spotsAll.filter((s) => {
    if (s.kind === "easy") return true;
    if (!me) return false;
    return s.ownerId === me.id || me.discoveredSpotIds.includes(s.id);
  });

  const allEvents = await recentEvents();
  const events = me
    ? allEvents
        .filter((e) => e.attackerId === me!.id || e.defenderId === me!.id)
        .slice(-12)
    : [];

  return {
    sectors,
    spots,
    players,
    me,
    events,
    serverNow: Date.now(),
    gatherTripMs: GATHER_TRIP_MS,
    buildingCatalog: BUILDING_CATALOG,
    authDisabled: AUTH_DISABLED,
  };
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
    return { error: "Place your house inside the sector" };
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
      return { error: "Villager must stay near the house (within 400m)" };
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
    villagerPost,
    villagers: STARTING.villagers,
    soldiers: 0,
    tanks: 0,
    peakSoldiers: 0,
    peakTanks: 0,
    gold: STARTING.gold,
    totalFarmed: 0,
    buildings: [],
    discoveredSpotIds: easyIds,
    lastGatherAt: now,
    lastRoamSpawnAt: 0,
    lastAttackAt: 0,
    updatedAt: now,
  });

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
  if (me.house) return { error: "You already have a house" };

  const sectors = await getSectors();
  const sector = sectors.find((s) => s.id === me.homeSectorId);
  if (!sector) return { error: "Sector missing" };

  if (!Number.isFinite(housePos.lat) || !Number.isFinite(housePos.lng)) {
    return { error: "Pick a spot for your house" };
  }
  if (!pointInRing(housePos, sector.ring)) {
    return { error: "Place your house inside your sector" };
  }

  const blocked = await assertClearGround(playerId, housePos);
  if (blocked) return blocked;

  let villagerPost = me.villagerPost;
  if (
    villagerPos &&
    Number.isFinite(villagerPos.lat) &&
    Number.isFinite(villagerPos.lng)
  ) {
    if (!pointInRing(villagerPos, sector.ring)) {
      return { error: "Place your villager inside the sector" };
    }
    if (distMeters(villagerPos, housePos) > 400) {
      return { error: "Villager must stay near the house (within 400m)" };
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
    villagerPost: villagerPost ?? housePos,
    lastGatherAt: now,
    updatedAt: now,
  });
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
  | { ok: true; gem: GemType; bonus: number; spotId: string }
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

  const sectors = await getSectors();
  const sector = sectors.find((s) => s.id === me.homeSectorId);
  if (!sector) return { error: "Home sector missing" };

  const view = { lat: opts.lat, lng: opts.lng };
  if (!pointInRing(view, sector.ring)) {
    return { error: "Roam inside your own sector" };
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
      s.ownerId === playerId
  );
  if (finds.length >= MAX_ROAM_FINDS) {
    return { error: "You've found every vein in this sector for now" };
  }

  const ahead = 35 + Math.random() * 45;
  let pos = offsetBearing(view, opts.bearing, ahead);
  pos = offsetBearing(pos, opts.bearing + 90, (Math.random() - 0.5) * 28);

  if (!pointInRing(pos, sector.ring)) {
    pos = offsetBearing(view, opts.bearing, 25);
  }
  if (!pointInRing(pos, sector.ring)) {
    return { error: "Edge of the sector — turn back and keep roaming" };
  }

  const tooClose = spots.some(
    (s) =>
      s.sectorId === me.homeSectorId &&
      distMeters(pos, { lat: s.lat, lng: s.lng }) < 25
  );
  if (tooClose) {
    pos = offsetBearing(view, opts.bearing + 40, 40);
    if (
      !pointInRing(pos, sector.ring) ||
      spots.some(
        (s) =>
          s.sectorId === me.homeSectorId &&
          distMeters(pos, { lat: s.lat, lng: s.lng }) < 20
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
    yield: meta.yield,
    refillMs: meta.refillMs,
    availableAt: 0,
    ownerId: playerId,
  };

  const bonus = meta.yield * 2;
  await setSpots([...spots, spot]);
  await setPlayer({
    ...me,
    discoveredSpotIds: [...me.discoveredSpotIds, spotId],
    gold: me.gold + bonus,
    totalFarmed: (me.totalFarmed || 0) + bonus,
    lastRoamSpawnAt: now,
    updatedAt: now,
  });
  return { ok: true, gem, bonus, spotId };
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

export async function collectHidden(
  playerId: string,
  spotId: string
): Promise<{ ok: true; gained?: number } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId) return { error: "Settle in a sector first" };
  if (!me.discoveredSpotIds.includes(spotId)) {
    return { error: "Explore and discover this spot first" };
  }
  const spots = await getSpots();
  const spot = spots.find((s) => s.id === spotId);
  if (!spot || spot.kind !== "hidden") return { error: "Not a hidden cache" };
  if (spot.sectorId !== me.homeSectorId) return { error: "Wrong sector" };
  const now = Date.now();
  if (spot.availableAt > now) {
    return { error: "Still refilling — come back later" };
  }

  await setPlayer({
    ...me,
    gold: me.gold + spot.yield,
    totalFarmed: (me.totalFarmed || 0) + spot.yield,
    updatedAt: now,
  });
  await setSpots(
    spots.map((s) =>
      s.id === spotId ? { ...s, availableAt: now + (s.refillMs || 45_000) } : s
    )
  );
  return { ok: true, gained: spot.yield };
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

  const sectors = await getSectors();
  const sector = sectors.find((s) => s.id === me.homeSectorId)!;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { error: "Tap a spot inside your sector to place it" };
  }
  const pos = { lat: lat!, lng: lng! };
  if (!pointInRing(pos, sector.ring)) {
    return { error: "Place it inside your own sector" };
  }

  const everyone = await getAllPlayers();
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
  const spots = await getSpots();
  const { player: fresh } = await accruePlayer(me, spots, true);
  if (fresh.gold < cat.cost) return { error: `Need ${cat.cost} gold` };

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
      },
    ],
    updatedAt: now,
  });
  return { ok: true };
}

export async function recruitSoldier(
  playerId: string
): Promise<{ ok: true } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId) return { error: "Settle in a sector first" };
  const spots = await getSpots();
  const { player: fresh } = await accruePlayer(me, spots, true);
  if (fresh.gold < SOLDIER_COST) {
    return { error: `Need ${SOLDIER_COST} gold to recruit a soldier` };
  }
  await setPlayer({
    ...fresh,
    gold: fresh.gold - SOLDIER_COST,
    soldiers: (fresh.soldiers || 0) + 1,
    peakSoldiers: Math.max(fresh.peakSoldiers || 0, (fresh.soldiers || 0) + 1),
    updatedAt: Date.now(),
  });
  return { ok: true };
}

export async function buildTank(
  playerId: string
): Promise<{ ok: true } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId) return { error: "Settle in a sector first" };
  const spots = await getSpots();
  const { player: fresh } = await accruePlayer(me, spots, true);
  if (fresh.gold < TANK_COST) {
    return { error: `Need ${TANK_COST} gold to build a tank` };
  }
  await setPlayer({
    ...fresh,
    gold: fresh.gold - TANK_COST,
    tanks: (fresh.tanks || 0) + 1,
    peakTanks: Math.max(fresh.peakTanks || 0, (fresh.tanks || 0) + 1),
    updatedAt: Date.now(),
  });
  return { ok: true };
}

export async function attackSector(
  playerId: string,
  targetPlayerId: string
): Promise<{ ok: true; battle: BattleReport } | { error: string }> {
  await bootstrap();
  const me = await getPlayer(playerId);
  if (!me?.homeSectorId) return { error: "Settle in a sector first" };
  if (!me.house) {
    return { error: "Rebuild your house before attacking" };
  }
  if ((me.soldiers || 0) + (me.tanks || 0) <= 0) {
    return { error: "Recruit soldiers or build tanks before attacking" };
  }
  if (!targetPlayerId || targetPlayerId === playerId) {
    return { error: "Pick someone else to attack" };
  }
  const now = Date.now();
  if (me.lastAttackAt && now - me.lastAttackAt < ATTACK_COOLDOWN_MS) {
    const wait = Math.ceil((ATTACK_COOLDOWN_MS - (now - me.lastAttackAt)) / 1000);
    return { error: `Army regrouping — ${wait}s until next attack` };
  }

  const defender = await getPlayer(targetPlayerId);
  if (!defender?.homeSectorId) {
    return { error: "That settler has no village" };
  }
  const targetSectorId = defender.homeSectorId;

  const atk = attackPower(me.soldiers, me.tanks || 0);
  const def = defensePower(defender);
  const win = atk > def;

  // 1 attack point = 1 HP. Losing raids still chip for half (min 1).
  const damageBudget = win ? atk : Math.max(1, Math.floor(atk / 2));
  let remaining = damageBudget;
  const destroyedNames: string[] = [];
  const damagedNames: string[] = [];

  // Turrets first, then other buildings, house last
  const targets = [...defender.buildings].sort((a, b) => {
    if (a.type === "turret" && b.type !== "turret") return -1;
    if (b.type === "turret" && a.type !== "turret") return 1;
    return b.builtAt - a.builtAt;
  });
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
      destroyedNames.push("House");
    }
  }

  const damageDealt = damageBudget - remaining;

  let soldiersLost: number;
  let tanksLost: number;
  let defenderSoldiersLost: number;
  let lootedGold = 0;

  if (win) {
    soldiersLost = Math.floor(me.soldiers * 0.4);
    tanksLost = Math.floor((me.tanks || 0) * 0.25);
    defenderSoldiersLost = Math.min(
      defender.soldiers || 0,
      Math.floor(me.soldiers / 2) || 1
    );
    if (survivingBuildings.length === 0 || houseDestroyed) {
      lootedGold = Math.min(defender.gold, 25);
    }
  } else {
    soldiersLost = me.soldiers;
    tanksLost = Math.ceil((me.tanks || 0) / 2);
    defenderSoldiersLost = Math.min(
      defender.soldiers || 0,
      Math.max(1, Math.floor(atk / 3))
    );
  }

  await setPlayer({
    ...defender,
    house: nextHouse,
    houseHp: nextHouseHp,
    // Gathering pauses without a house — reset anchor so rebuild isn't back-paid
    lastGatherAt: houseDestroyed ? now : defender.lastGatherAt,
    buildings: survivingBuildings,
    soldiers: Math.max(0, (defender.soldiers || 0) - defenderSoldiersLost),
    gold: defender.gold - lootedGold,
    lastAttackAt: now,
    updatedAt: now,
  });

  await setPlayer({
    ...me,
    soldiers: Math.max(0, (me.soldiers || 0) - soldiersLost),
    tanks: Math.max(0, (me.tanks || 0) - tanksLost),
    gold: me.gold + lootedGold,
    lastAttackAt: now,
    updatedAt: now,
  });

  const destroyed = destroyedNames.length ? destroyedNames.join(", ") : null;
  const sectors = await getSectors();
  const sector = sectors.find((s) => s.id === targetSectorId);
  await pushEvent({
    id: `ev_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    ts: now,
    type: "attack",
    attackerId: playerId,
    attackerName: me.name,
    defenderId: defender.id,
    defenderName: defender.name,
    sectorId: targetSectorId,
    sectorName: sector?.name ?? targetSectorId,
    win,
    damage: damageDealt,
    destroyed,
    lootedGold,
    defenderSoldiersLost,
    attackPower: atk,
    defensePower: def,
    soldiersLost,
    tanksLost,
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
      soldiersLost,
      tanksLost,
      defenderSoldiersLost,
    },
  };
}


export { buildingBonus };
