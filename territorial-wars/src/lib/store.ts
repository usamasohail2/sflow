import { Redis } from "@upstash/redis";
import {
  BUILDING_CATALOG,
  EXPLORE_ZOOM,
  GATHER_TRIP_MS,
  GEM_META,
  INVITE_VILLAGER_BONUS,
  MAX_ROAM_FINDS,
  ROAM_METERS_TO_SPAWN,
  SPAWN_COOLDOWN_MS,
  STARTING,
  buildingBonus,
  buildingCost,
  type BuildingType,
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
  pickRoamGem,
  randomPointInRing,
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
    updatedAt: Date.now(),
  };
}

function normalizeSpot(s: ResourceSpot): ResourceSpot {
  const gem: GemType =
    s.gem && s.gem in GEM_META
      ? s.gem
      : s.kind === "easy"
        ? "amber"
        : "emerald";
  return {
    ...s,
    gem,
    yield: s.yield || GEM_META[gem].yield,
    refillMs: s.refillMs ?? GEM_META[gem].refillMs,
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

export async function loadState(): Promise<GameState> {
  const r = redis();
  if (!r) {
    const cached = memory.get(STATE_KEY) ?? emptyState();
    const seeded = seedSectorsIfEmpty(cached);
    memory.set(STATE_KEY, seeded);
    return structuredClone(seeded);
  }
  const raw = await r.get(STATE_KEY);
  const state = seedSectorsIfEmpty(migrateLegacy(raw));
  if (!raw) await saveState(state);
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
    gold: p.gold,
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
      villagers: 0,
      gold: STARTING.gold,
      buildings: [],
      discoveredSpotIds: [],
      inviteCode,
      invitedBy,
      lastGatherAt: now,
      lastRoamSpawnAt: 0,
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
  return {
    sectors: state.sectors,
    spots,
    players: Object.values(state.players).map(publicPlayer),
    me,
    serverNow,
    gatherTripMs: GATHER_TRIP_MS,
    buildingCatalog: BUILDING_CATALOG,
    authDisabled: AUTH_DISABLED,
  };
}

export async function claimSector(
  playerId: string,
  sectorId: string
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

  const house = ringCentroid(sector.ring);
  const now = Date.now();
  state.spots = seedSpotsForSector(sector, house, state.spots);

  const easyIds = state.spots
    .filter((s) => s.sectorId === sectorId && s.kind === "easy")
    .map((s) => s.id);

  state.players[playerId] = {
    ...me,
    homeSectorId: sectorId,
    house,
    villagers: STARTING.villagers,
    gold: STARTING.gold,
    buildings: [],
    discoveredSpotIds: easyIds,
    lastGatherAt: now,
    lastRoamSpawnAt: 0,
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
  if ((opts.roamMeters || 0) < ROAM_METERS_TO_SPAWN * 0.85) {
    return { error: "Keep roaming…" };
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
  type: BuildingType
): Promise<{ ok: true } | { error: string }> {
  const { state } = await loadAccruedState();
  const me = state.players[playerId];
  if (!me?.homeSectorId || !me.house) return { error: "Claim a sector first" };
  if (!BUILDING_CATALOG.some((b) => b.type === type)) {
    return { error: "Unknown building" };
  }
  if (me.buildings.some((b) => b.type === type)) {
    return { error: "You already built that" };
  }
  const cost = buildingCost(type);
  if (me.gold < cost) return { error: `Need ${cost} gold` };

  const sector = state.sectors.find((s) => s.id === me.homeSectorId)!;
  const pos = randomPointInRing(sector.ring) ?? me.house;
  const now = Date.now();

  state.players[playerId] = {
    ...me,
    gold: me.gold - cost,
    buildings: [
      ...me.buildings,
      {
        id: `b_${now.toString(36)}`,
        type,
        lat: pos.lat,
        lng: pos.lng,
        builtAt: now,
      },
    ],
    updatedAt: now,
  };
  await saveState(state);
  return { ok: true };
}

export { buildingBonus, publicPlayer };
