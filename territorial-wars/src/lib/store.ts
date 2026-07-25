import { Redis } from "@upstash/redis";
import {
  ATTACK_COOLDOWN_MS,
  BUILDING_CATALOG,
  EXPLORE_ZOOM,
  GATHER_TRIP_MS,
  GEM_META,
  HOUSE_FOOTPRINT_M,
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
  type BuildingType,
  type GameEvent,
  type GameSnapshot,
  type GameState,
  type GemType,
  type Player,
  type PublicPlayer,
  type ResourceSpot,
  type Sector,
} from "@/lib/gameTypes";
import { AUTH_DISABLED, buildDummySectors } from "@/lib/devMode";
import { pointInRing } from "@/lib/geo";
import {
  distMeters,
  offsetBearing,
  offsetMeters,
  pickRoamGem,
  ringCentroid,
  seedSpotsForSector,
} from "@/lib/mapMath";
import { accrueGather } from "@/lib/rules";

const STATE_KEY = "itw:v2:state";
const memory = new Map<string, GameState>();

function redis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function emptyState(): GameState {
  return {
    version: 2,
    sectors: [],
    spots: [],
    players: {},
    invites: {},
    events: [],
    updatedAt: Date.now(),
  };
}

function normalizeSpot(s: ResourceSpot): ResourceSpot {
  // Easy house nodes are wood & stone; roam finds keep their gem type
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

function seedSectorsIfEmpty(state: GameState): GameState {
  if (state.sectors.length > 0) return state;
  // Starter map: F-6 + G-9 so play works before admin draws more
  return {
    ...state,
    sectors: buildDummySectors(),
    updatedAt: Date.now(),
  };
}

function migrateLegacy(raw: unknown): GameState {
  if (!raw || typeof raw !== "object") return emptyState();
  const o = raw as Record<string, unknown>;

  // New shape
  if (o.version === 2 && Array.isArray(o.sectors)) {
    const players = (o.players as Record<string, Player>) ?? {};
    for (const p of Object.values(players)) {
      if (p.lastRoamSpawnAt == null) p.lastRoamSpawnAt = 0;
      if (p.lastAttackAt == null) p.lastAttackAt = 0;
      if (p.soldiers == null) p.soldiers = 0;
      if (p.tanks == null) p.tanks = 0;
      if (p.peakSoldiers == null) p.peakSoldiers = p.soldiers;
      if (p.peakTanks == null) p.peakTanks = p.tanks;
      if (p.villagerPost === undefined) p.villagerPost = null;
      if (p.totalFarmed == null) p.totalFarmed = p.gold || 0;
      p.buildings = (p.buildings || []).map((b) => ({
        ...b,
        hp: b.hp ?? catalogItem(b.type).hp,
      }));
    }
    const spots = (Array.isArray(o.spots) ? (o.spots as ResourceSpot[]) : []).map(
      normalizeSpot
    );
    return {
      version: 2,
      sectors: o.sectors as Sector[],
      spots,
      players,
      invites: (o.invites as Record<string, string>) ?? {},
      events: Array.isArray(o.events) ? (o.events as GameEvent[]) : [],
      updatedAt: Number(o.updatedAt) || Date.now(),
    };
  }

  // Legacy dig/control keys — keep sectors only
  const sectors = Array.isArray(o.sectors) ? (o.sectors as Sector[]) : [];
  return {
    ...emptyState(),
    sectors: sectors.map((s) => ({
      id: s.id,
      name: s.name,
      ring: s.ring,
      createdAt: s.createdAt ?? Date.now(),
      updatedAt: s.updatedAt ?? Date.now(),
    })),
  };
}

const BOT_ID = "bot_garrison";
const BOT_SECTOR_ID = "sec_e7";
const BOT_RESTOCK_MS = 3 * 60_000;

/**
 * Keep a bot-held sector stocked with buildings + soldiers so players can
 * practice attacks. Razed defenses restock a few minutes after the raid.
 */
function ensureRivalGarrison(state: GameState): boolean {
  let changed = false;
  const now = Date.now();

  let sector = state.sectors.find((s) => s.id === BOT_SECTOR_ID);
  if (!sector) {
    const seeded = buildDummySectors(now).find((s) => s.id === BOT_SECTOR_ID);
    if (!seeded) return changed;
    sector = seeded;
    state.sectors.push(sector);
    changed = true;
  }

  const center = ringCentroid(sector.ring);
  const defaultBuildings = () => {
    const turretPos = offsetMeters(center, 65, 5);
    const millPos = offsetMeters(center, -80, -25);
    const warehousePos = offsetMeters(center, 15, 85);
    return [
      {
        id: "bot_b_turret",
        type: "turret" as BuildingType,
        lat: turretPos.lat,
        lng: turretPos.lng,
        hp: catalogItem("turret").hp,
        builtAt: now,
      },
      {
        id: "bot_b_mill",
        type: "mill" as BuildingType,
        lat: millPos.lat,
        lng: millPos.lng,
        hp: catalogItem("mill").hp,
        builtAt: now,
      },
      {
        id: "bot_b_warehouse",
        type: "warehouse" as BuildingType,
        lat: warehousePos.lat,
        lng: warehousePos.lng,
        hp: catalogItem("warehouse").hp,
        builtAt: now,
      },
    ];
  };

  const bot = state.players[BOT_ID];
  if (!bot) {
    state.players[BOT_ID] = {
      id: BOT_ID,
      name: "Rival Garrison",
      homeSectorId: BOT_SECTOR_ID,
      house: center,
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
      // Reused as the restock timer for the bot
      lastRoamSpawnAt: now,
      lastAttackAt: 0,
      createdAt: now,
      updatedAt: now,
    };
    state.invites["RIVAL0"] = BOT_ID;
    changed = true;
  } else {
    const razed =
      bot.buildings.length < 3 ||
      (bot.soldiers || 0) < 1 ||
      bot.buildings.some((b) => b.hp < catalogItem(b.type).hp);
    // lastAttackAt on the bot marks when it was last raided
    if (razed && now - (bot.lastAttackAt || 0) > BOT_RESTOCK_MS) {
      state.players[BOT_ID] = {
        ...bot,
        soldiers: Math.max(bot.soldiers || 0, 1),
        buildings: defaultBuildings(),
        updatedAt: now,
      };
      changed = true;
    }
  }

  return changed;
}

export async function loadState(): Promise<GameState> {
  const r = redis();
  if (!r) {
    const cached = memory.get(STATE_KEY) ?? emptyState();
    const seeded = seedSectorsIfEmpty(cached);
    ensureRivalGarrison(seeded);
    memory.set(STATE_KEY, seeded);
    return structuredClone(seeded);
  }
  const raw = await r.get(STATE_KEY);
  const state = seedSectorsIfEmpty(migrateLegacy(raw));
  const garrisonChanged = ensureRivalGarrison(state);
  if (!raw || garrisonChanged) await saveState(state);
  return structuredClone(state);
}

export async function saveState(state: GameState): Promise<void> {
  state.updatedAt = Date.now();
  const r = redis();
  if (!r) {
    memory.set(STATE_KEY, structuredClone(state));
    return;
  }
  await r.set(STATE_KEY, state);
}

export async function getSectors(): Promise<Sector[]> {
  const state = await loadState();
  return state.sectors;
}

export async function saveSectors(sectors: Sector[]): Promise<void> {
  const state = await loadState();
  state.sectors = sectors;
  // Drop spots for deleted sectors
  const ids = new Set(sectors.map((s) => s.id));
  state.spots = state.spots.filter((s) => ids.has(s.sectorId));
  await saveState(state);
}

export function makeInviteCode(seed: string): string {
  const base = seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base || "ITW"}${rand}`.slice(0, 8);
}

function publicPlayer(p: Player): PublicPlayer {
  return {
    id: p.id,
    name: p.name,
    homeSectorId: p.homeSectorId,
    house: p.house,
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

export async function loadAccruedState(): Promise<{
  state: GameState;
  serverNow: number;
}> {
  const state = await loadState();
  const now = Date.now();
  // Drop legacy pre-placed hiddens (roam-spawned finds always have ownerId)
  const before = state.spots.length;
  state.spots = state.spots
    .map(normalizeSpot)
    .filter((s) => s.kind === "easy" || Boolean(s.ownerId));
  const changedSpots = state.spots.length !== before;

  const { players, spots, changed } = accrueGather(
    state.players,
    state.spots,
    now
  );
  if (changed || changedSpots) {
    state.players = players;
    state.spots = spots;
    await saveState(state);
  }
  return { state, serverNow: now };
}

export async function ensurePlayer(
  id: string,
  name: string,
  email?: string,
  image?: string | null,
  inviteCodeFromClient?: string | null
): Promise<Player> {
  const { state } = await loadAccruedState();
  const now = Date.now();
  let me = state.players[id];

  if (!me) {
    let inviteCode = makeInviteCode(name || id);
    while (state.invites[inviteCode]) {
      inviteCode = makeInviteCode(id + Math.random());
    }

    let invitedBy: string | null = null;
    const ref = inviteCodeFromClient?.trim().toUpperCase();
    if (ref) {
      const ownerId = state.invites[ref];
      if (ownerId && ownerId !== id && state.players[ownerId]) {
        invitedBy = ownerId;
        const inviter = state.players[ownerId]!;
        state.players[ownerId] = {
          ...inviter,
          villagers: inviter.villagers + INVITE_VILLAGER_BONUS,
          updatedAt: now,
        };
      }
    }

    me = {
      id,
      name: name || "Settler",
      email,
      image: image ?? null,
      homeSectorId: null,
      house: null,
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
    state.players[id] = me;
    state.invites[inviteCode] = id;
    await saveState(state);
  } else {
    me = {
      ...me,
      name: name || me.name,
      image: image !== undefined ? image : me.image,
    };
    state.players[id] = me;
    await saveState(state);
  }

  return (await loadAccruedState()).state.players[id]!;
}

export async function getSnapshot(meId?: string | null): Promise<GameSnapshot> {
  const { state, serverNow } = await loadAccruedState();
  const me = meId ? state.players[meId] ?? null : null;
  // Only show easy nodes + roam finds the player owns / discovered
  const spots = state.spots.filter((s) => {
    if (s.kind === "easy") {
      return !me?.homeSectorId || s.sectorId === me.homeSectorId;
    }
    if (!me) return false;
    return (
      s.ownerId === me.id || me.discoveredSpotIds.includes(s.id)
    );
  });
  const events = me
    ? (state.events || [])
        .filter((e) => e.attackerId === me.id || e.defenderId === me.id)
        .slice(-12)
    : [];
  return {
    sectors: state.sectors,
    spots,
    players: Object.values(state.players).map(publicPlayer),
    me,
    events,
    serverNow,
    gatherTripMs: GATHER_TRIP_MS,
    buildingCatalog: BUILDING_CATALOG,
    authDisabled: AUTH_DISABLED,
  };
}

export async function claimSector(
  playerId: string,
  sectorId: string,
  housePos?: { lat: number; lng: number },
  villagerPos?: { lat: number; lng: number }
): Promise<{ ok: true } | { error: string }> {
  const { state } = await loadAccruedState();
  const me = state.players[playerId];
  if (!me) return { error: "Player missing" };
  if (me.homeSectorId) {
    return { error: "You already claimed a sector — it's yours forever." };
  }
  const sector = state.sectors.find((s) => s.id === sectorId);
  if (!sector) return { error: "Sector not found" };

  const taken = Object.values(state.players).some(
    (p) => p.homeSectorId === sectorId
  );
  if (taken) return { error: "That sector is already claimed" };

  // Player places the house; fall back to centroid for API callers
  const house =
    housePos &&
    Number.isFinite(housePos.lat) &&
    Number.isFinite(housePos.lng)
      ? housePos
      : ringCentroid(sector.ring);
  if (!pointInRing(house, sector.ring)) {
    return { error: "Place your house inside the sector" };
  }
  for (const p of Object.values(state.players)) {
    for (const b of p.buildings) {
      if (
        distMeters(house, { lat: b.lat, lng: b.lng }) <
        HOUSE_FOOTPRINT_M + catalogItem(b.type).footprintM
      ) {
        return { error: "That ground is occupied — pick a clear spot" };
      }
    }
    if (
      p.house &&
      distMeters(house, p.house) < HOUSE_FOOTPRINT_M * 2
    ) {
      return { error: "Too close to another house" };
    }
  }

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

  const now = Date.now();
  state.spots = seedSpotsForSector(sector, house, state.spots);

  const easyIds = state.spots
    .filter((s) => s.sectorId === sectorId && s.kind === "easy")
    .map((s) => s.id);

  state.players[playerId] = {
    ...me,
    homeSectorId: sectorId,
    house,
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
  };

  await saveState(state);
  return { ok: true };
}

/**
 * After roaming fully zoomed inside your sector, spawn a gem ahead of the camera.
 */
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
  const { state } = await loadAccruedState();
  const me = state.players[playerId];
  if (!me?.homeSectorId || !me.house) return { error: "Claim a sector first" };
  if (opts.zoom < EXPLORE_ZOOM) {
    return { error: "Zoom all the way in to explore" };
  }
  if ((opts.roamMeters || 0) < ROAM_METERS_TO_SPAWN) {
    return { error: "Keep roaming…" };
  }
  if ((opts.exploreMs || 0) < ROAM_MIN_EXPLORE_MS) {
    return { error: "Explore a bit longer…" };
  }

  const sector = state.sectors.find((s) => s.id === me.homeSectorId);
  if (!sector) return { error: "Home sector missing" };

  const view: { lat: number; lng: number } = {
    lat: opts.lat,
    lng: opts.lng,
  };
  if (!pointInRing(view, sector.ring)) {
    return { error: "Roam inside your own sector" };
  }

  const now = Date.now();
  if (me.lastRoamSpawnAt && now - me.lastRoamSpawnAt < SPAWN_COOLDOWN_MS) {
    return { error: "Keep exploring…" };
  }

  const finds = state.spots.filter(
    (s) =>
      s.sectorId === me.homeSectorId &&
      s.kind === "hidden" &&
      s.ownerId === playerId
  );
  if (finds.length >= MAX_ROAM_FINDS) {
    return { error: "You've found every vein in this sector for now" };
  }

  // Place gem "in front" of the explorer along camera bearing
  const ahead = 35 + Math.random() * 45;
  let pos = offsetBearing(view, opts.bearing, ahead);
  // slight lateral drift so it isn't dead-center
  pos = offsetBearing(pos, opts.bearing + 90, (Math.random() - 0.5) * 28);

  if (!pointInRing(pos, sector.ring)) {
    pos = offsetBearing(view, opts.bearing, 25);
  }
  if (!pointInRing(pos, sector.ring)) {
    return { error: "Edge of the sector — turn back and keep roaming" };
  }

  // Don't stack on existing spots
  const tooClose = state.spots.some(
    (s) =>
      s.sectorId === me.homeSectorId &&
      distMeters(pos, { lat: s.lat, lng: s.lng }) < 25
  );
  if (tooClose) {
    pos = offsetBearing(view, opts.bearing + 40, 40);
    if (
      !pointInRing(pos, sector.ring) ||
      state.spots.some(
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
  state.spots.push(spot);
  state.players[playerId] = {
    ...me,
    discoveredSpotIds: [...me.discoveredSpotIds, spotId],
    gold: me.gold + bonus,
    totalFarmed: (me.totalFarmed || 0) + bonus,
    lastRoamSpawnAt: now,
    updatedAt: now,
  };
  await saveState(state);
  return { ok: true, gem, bonus, spotId };
}

export async function discoverSpot(
  playerId: string,
  spotId: string
): Promise<{ ok: true; bonus?: number } | { error: string }> {
  const { state } = await loadAccruedState();
  const me = state.players[playerId];
  if (!me?.homeSectorId) return { error: "Claim a sector first" };
  const spot = state.spots.find((s) => s.id === spotId);
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
  state.players[playerId] = {
    ...me,
    discoveredSpotIds: [...me.discoveredSpotIds, spotId],
    gold: me.gold + bonus,
    totalFarmed: (me.totalFarmed || 0) + bonus,
    updatedAt: now,
  };
  // Start refill timer after find bonus
  state.spots = state.spots.map((s) =>
    s.id === spotId
      ? { ...s, availableAt: now + (s.refillMs || 45_000) }
      : s
  );
  await saveState(state);
  return { ok: true, bonus };
}

export async function collectHidden(
  playerId: string,
  spotId: string
): Promise<{ ok: true; gained?: number } | { error: string }> {
  const { state } = await loadAccruedState();
  const me = state.players[playerId];
  if (!me?.homeSectorId) return { error: "Claim a sector first" };
  if (!me.discoveredSpotIds.includes(spotId)) {
    return { error: "Explore and discover this spot first" };
  }
  const spot = state.spots.find((s) => s.id === spotId);
  if (!spot || spot.kind !== "hidden") return { error: "Not a hidden cache" };
  if (spot.sectorId !== me.homeSectorId) return { error: "Wrong sector" };
  const now = Date.now();
  if (spot.availableAt > now) {
    return { error: "Still refilling — come back later" };
  }

  state.players[playerId] = {
    ...me,
    gold: me.gold + spot.yield,
    totalFarmed: (me.totalFarmed || 0) + spot.yield,
    updatedAt: now,
  };
  state.spots = state.spots.map((s) =>
    s.id === spotId
      ? { ...s, availableAt: now + (s.refillMs || 45_000) }
      : s
  );
  await saveState(state);
  return { ok: true, gained: spot.yield };
}

export async function renamePlayer(
  playerId: string,
  name: string
): Promise<{ ok: true } | { error: string }> {
  const trimmed = name.trim().slice(0, 24);
  if (trimmed.length < 2) return { error: "Name too short" };
  const { state } = await loadAccruedState();
  const me = state.players[playerId];
  if (!me) return { error: "Player missing" };
  state.players[playerId] = { ...me, name: trimmed, updatedAt: Date.now() };
  await saveState(state);
  return { ok: true };
}

export async function buildBuilding(
  playerId: string,
  type: BuildingType,
  lat?: number,
  lng?: number
): Promise<{ ok: true } | { error: string }> {
  const { state } = await loadAccruedState();
  const me = state.players[playerId];
  if (!me?.homeSectorId || !me.house) return { error: "Claim a sector first" };
  const cat = BUILDING_CATALOG.find((b) => b.type === type);
  if (!cat) return { error: "Unknown building" };

  const sector = state.sectors.find((s) => s.id === me.homeSectorId)!;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { error: "Tap a spot inside your sector to place it" };
  }
  const pos = { lat: lat!, lng: lng! };
  if (!pointInRing(pos, sector.ring)) {
    return { error: "Place it inside your own sector" };
  }

  // Ground collision vs every building and house on the map
  for (const p of Object.values(state.players)) {
    for (const b of p.buildings) {
      const otherFp = catalogItem(b.type).footprintM;
      if (
        distMeters(pos, { lat: b.lat, lng: b.lng }) <
        cat.footprintM + otherFp
      ) {
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

  const cost = cat.cost;
  if (me.gold < cost) return { error: `Need ${cost} gold` };

  const now = Date.now();
  state.players[playerId] = {
    ...me,
    gold: me.gold - cost,
    buildings: [
      ...me.buildings,
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
  };
  await saveState(state);
  return { ok: true };
}

export async function recruitSoldier(
  playerId: string
): Promise<{ ok: true } | { error: string }> {
  const { state } = await loadAccruedState();
  const me = state.players[playerId];
  if (!me?.homeSectorId) return { error: "Claim a sector first" };
  if (me.gold < SOLDIER_COST) {
    return { error: `Need ${SOLDIER_COST} gold to recruit a soldier` };
  }
  state.players[playerId] = {
    ...me,
    gold: me.gold - SOLDIER_COST,
    soldiers: (me.soldiers || 0) + 1,
    peakSoldiers: Math.max(me.peakSoldiers || 0, (me.soldiers || 0) + 1),
    updatedAt: Date.now(),
  };
  await saveState(state);
  return { ok: true };
}

export async function buildTank(
  playerId: string
): Promise<{ ok: true } | { error: string }> {
  const { state } = await loadAccruedState();
  const me = state.players[playerId];
  if (!me?.homeSectorId) return { error: "Claim a sector first" };
  if (me.gold < TANK_COST) {
    return { error: `Need ${TANK_COST} gold to build a tank` };
  }
  state.players[playerId] = {
    ...me,
    gold: me.gold - TANK_COST,
    tanks: (me.tanks || 0) + 1,
    peakTanks: Math.max(me.peakTanks || 0, (me.tanks || 0) + 1),
    updatedAt: Date.now(),
  };
  await saveState(state);
  return { ok: true };
}

export async function attackSector(
  playerId: string,
  targetSectorId: string
): Promise<{ ok: true; battle: BattleReport } | { error: string }> {
  const { state } = await loadAccruedState();
  const me = state.players[playerId];
  if (!me?.homeSectorId) return { error: "Claim a sector first" };
  if ((me.soldiers || 0) + (me.tanks || 0) <= 0) {
    return { error: "Recruit soldiers or build tanks before attacking" };
  }
  if (targetSectorId === me.homeSectorId) {
    return { error: "That's your own sector" };
  }
  const now = Date.now();
  if (me.lastAttackAt && now - me.lastAttackAt < ATTACK_COOLDOWN_MS) {
    const wait = Math.ceil(
      (ATTACK_COOLDOWN_MS - (now - me.lastAttackAt)) / 1000
    );
    return { error: `Army regrouping — ${wait}s until next attack` };
  }

  const defender = Object.values(state.players).find(
    (p) => p.homeSectorId === targetSectorId
  );
  if (!defender) return { error: "Nobody holds that sector" };

  const atk = attackPower(me.soldiers, me.tanks || 0);
  const def = defensePower(defender);
  const win = atk > def;

  // Damage chews through building hp — turrets first, then newest.
  // Winning armies deal full damage; repelled ones still deal half.
  const damageBudget = win ? atk : Math.floor(atk / 2);
  let remaining = damageBudget;
  const destroyedNames: string[] = [];
  const damagedNames: string[] = [];
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
    .filter(Boolean) as typeof defender.buildings;
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
    if (defender.buildings.length === 0) {
      lootedGold = Math.min(defender.gold, 25);
    }
  } else {
    soldiersLost = me.soldiers;
    tanksLost = Math.ceil((me.tanks || 0) / 2);
    defenderSoldiersLost = Math.min(
      defender.soldiers || 0,
      Math.floor(atk / 20)
    );
  }

  state.players[defender.id] = {
    ...defender,
    buildings: survivingBuildings,
    soldiers: Math.max(0, (defender.soldiers || 0) - defenderSoldiersLost),
    gold: defender.gold - lootedGold,
    lastAttackAt: now,
    updatedAt: now,
  };

  const meNow = state.players[playerId]!;
  state.players[playerId] = {
    ...meNow,
    soldiers: Math.max(0, (me.soldiers || 0) - soldiersLost),
    tanks: Math.max(0, (me.tanks || 0) - tanksLost),
    gold: meNow.gold + lootedGold,
    lastAttackAt: now,
    updatedAt: now,
  };

  const destroyed = destroyedNames.length
    ? destroyedNames.join(", ")
    : null;
  const sector = state.sectors.find((s) => s.id === targetSectorId);
  const event: GameEvent = {
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
  };
  state.events = [...(state.events || []), event].slice(-50);

  await saveState(state);
  return {
    ok: true,
    battle: {
      win,
      attackPower: atk,
      defensePower: def,
      damage: damageDealt,
      destroyed,
      damagedBuildings: damagedNames,
      lootedGold,
      soldiersLost,
      tanksLost,
      defenderSoldiersLost,
    },
  };
}

export { buildingBonus, publicPlayer };
