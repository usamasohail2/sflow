export type LatLng = { lat: number; lng: number };

export type Sector = {
  id: string;
  name: string;
  ring: [number, number][];
  createdAt: number;
  updatedAt: number;
};

export type ResourceSpotKind = "easy" | "hidden";

/** Visual / rarity of a gather node */
export type GemType =
  | "wood"
  | "stone"
  | "amber"
  | "emerald"
  | "sapphire"
  | "ruby"
  | "diamond";

export type ResourceSpot = {
  id: string;
  sectorId: string;
  kind: ResourceSpotKind;
  gem: GemType;
  lat: number;
  lng: number;
  /** Gold granted each time a villager completes a trip involving this spot */
  yield: number;
  /** ms until a depleted hidden spot refills (easy spots never deplete) */
  refillMs: number;
  /** When this spot next becomes available (0 = available now) */
  availableAt: number;
  /** Player who spawned this find (roam discovers) */
  ownerId?: string;
};

export const GEM_META: Record<
  GemType,
  { label: string; yield: number; refillMs: number }
> = {
  wood: { label: "Wood", yield: 2, refillMs: 0 },
  stone: { label: "Stone", yield: 2, refillMs: 0 },
  amber: { label: "Amber", yield: 3, refillMs: 0 },
  emerald: { label: "Emerald", yield: 5, refillMs: 40_000 },
  sapphire: { label: "Sapphire", yield: 7, refillMs: 50_000 },
  ruby: { label: "Ruby", yield: 9, refillMs: 55_000 },
  diamond: { label: "Diamond", yield: 14, refillMs: 70_000 },
};

/** Fully zoomed-in explore threshold (Mapbox zoom) */
export const EXPLORE_ZOOM = 15.6;
/** Play map starts here — sector-level, walls readable */
export const PLAY_ZOOM = 14.4;
/** Don't pull out past a couple of sectors */
export const PLAY_MIN_ZOOM = 13.2;
/** Street-close ceiling (keeps explore zoom reachable) */
export const PLAY_MAX_ZOOM = 16.2;
/** How far (m) you must roam while zoomed before a gem can appear */
export const ROAM_METERS_TO_SPAWN = 240;
/** Must stay exploring (zoomed in, in sector) this long before a find */
export const ROAM_MIN_EXPLORE_MS = 28_000;
/** Min time between roam spawns */
export const SPAWN_COOLDOWN_MS = 55_000;
/** Cap finds spawned in a sector */
export const MAX_ROAM_FINDS = 10;

export type BuildingType = "mill" | "warehouse" | "well" | "turret";

export type Building = {
  id: string;
  type: BuildingType;
  lat: number;
  lng: number;
  hp: number;
  builtAt: number;
};

export type Player = {
  id: string;
  name: string;
  email?: string;
  image?: string | null;
  /** Home sector — set once; many players may share a sector */
  homeSectorId: string | null;
  house: LatLng | null;
  /** House hit points — 0 / missing house means rebuild required */
  houseHp: number;
  /** Where the villager idles / starts gather trips (player-placed) */
  villagerPost: LatLng | null;
  villagers: number;
  soldiers: number;
  tanks: number;
  /** Highest counts reached — garrison health bars show current/peak */
  peakSoldiers: number;
  peakTanks: number;
  gold: number;
  /** Lifetime resources farmed — global ranking metric */
  totalFarmed: number;
  buildings: Building[];
  /** Hidden spots this player has found */
  discoveredSpotIds: string[];
  inviteCode: string;
  invitedBy: string | null;
  /** Anchor for gather accrual */
  lastGatherAt: number;
  /** Last time a roam-find gem spawned for this player */
  lastRoamSpawnAt: number;
  /** Attack cooldown anchor */
  lastAttackAt: number;
  createdAt: number;
  updatedAt: number;
};

export type GameState = {
  version: 2;
  sectors: Sector[];
  spots: ResourceSpot[];
  players: Record<string, Player>;
  invites: Record<string, string>;
  events: GameEvent[];
  updatedAt: number;
};

export type PublicPlayer = {
  id: string;
  name: string;
  homeSectorId: string | null;
  house: LatLng | null;
  houseHp: number;
  /** Visible so others can see your villager on the map */
  villagerPost: LatLng | null;
  villagers: number;
  soldiers: number;
  tanks: number;
  peakSoldiers: number;
  peakTanks: number;
  gold: number;
  totalFarmed: number;
  buildings: Building[];
  discoveredSpotIds: string[];
};

export type BuildingCatalogItem = {
  type: BuildingType;
  name: string;
  cost: number;
  blurb: string;
  /** Extra gold per villager trip */
  tripBonus: number;
  /** Occupied ground radius in meters — no other building may overlap */
  footprintM: number;
  hp: number;
  /** Defense power contributed when your sector is attacked */
  defense: number;
};

export type BattleReport = {
  win: boolean;
  attackPower: number;
  defensePower: number;
  /** Total hp damage dealt to structures (incl. house) */
  damage: number;
  /** Names of buildings fully destroyed */
  destroyed: string | null;
  /** Buildings damaged but still standing */
  damagedBuildings: string[];
  /** True when the defender's house was razed */
  houseDestroyed: boolean;
  /** House took damage but is still standing */
  houseDamaged: boolean;
  lootedGold: number;
  soldiersLost: number;
  tanksLost: number;
  defenderSoldiersLost: number;
};

export type GameEvent = {
  id: string;
  ts: number;
  type: "attack";
  attackerId: string;
  attackerName: string;
  defenderId: string;
  defenderName: string;
  sectorId: string;
  sectorName: string;
  win: boolean;
  damage: number;
  destroyed: string | null;
  lootedGold: number;
  defenderSoldiersLost: number;
  /** Optional — present on newer battle events */
  attackPower?: number;
  defensePower?: number;
  soldiersLost?: number;
  tanksLost?: number;
  damagedBuildings?: string[];
  houseDestroyed?: boolean;
  houseDamaged?: boolean;
};

export type GameSnapshot = {
  sectors: Sector[];
  spots: ResourceSpot[];
  players: PublicPlayer[];
  me: Player | null;
  /** Battle events involving me (attacker or defender), newest last */
  events: GameEvent[];
  serverNow: number;
  gatherTripMs: number;
  buildingCatalog: BuildingCatalogItem[];
  authDisabled: boolean;
  /** Where game state is stored — supabase is the durable target */
  storageBackend: "supabase" | "redis" | "blob" | "memory";
};

/** One gather trip duration — villager walk loop matches this */
export const GATHER_TRIP_MS = 4000;

export const STARTING = {
  villagers: 1,
  gold: 0,
} as const;

export const INVITE_VILLAGER_BONUS = 1;

/** House ground radius (m) for overlap checks */
export const HOUSE_FOOTPRINT_M = 30;

/** Simple house HP — each attack point chips 1 HP */
export const HOUSE_MAX_HP = 5;

export const SOLDIER_COST = 30;
export const TANK_COST = 90;
export const ATTACK_COOLDOWN_MS = 60_000;

/**
 * Building HP uses the same small scale as attack/defense points
 * so "Attack 3 vs Defense 2 → dealt 3 damage" is readable.
 */
export const BUILDING_CATALOG: BuildingCatalogItem[] = [
  {
    type: "mill",
    name: "Grain mill",
    cost: 35,
    blurb: "+2 gold each trip",
    tripBonus: 2,
    footprintM: 34,
    hp: 3,
    defense: 0,
  },
  {
    type: "warehouse",
    name: "Warehouse",
    cost: 55,
    blurb: "+3 gold each trip",
    tripBonus: 3,
    footprintM: 42,
    hp: 4,
    defense: 0,
  },
  {
    type: "well",
    name: "Village well",
    cost: 45,
    blurb: "+2 gold each trip",
    tripBonus: 2,
    footprintM: 26,
    hp: 2,
    defense: 0,
  },
  {
    type: "turret",
    name: "Guard turret",
    cost: 60,
    blurb: "Defends your sector (+2 def)",
    tripBonus: 0,
    footprintM: 22,
    hp: 4,
    defense: 2,
  },
];

export function catalogItem(type: BuildingType): BuildingCatalogItem {
  return BUILDING_CATALOG.find((b) => b.type === type) ?? BUILDING_CATALOG[0];
}

export function buildingCost(type: BuildingType): number {
  return catalogItem(type).cost;
}

export function buildingBonus(buildings: Building[]): number {
  let n = 0;
  for (const b of buildings) n += catalogItem(b.type).tripBonus;
  return n;
}

/**
 * Simple combat:
 *  Attack = soldiers×1 + tanks×3
 *  Defense = house(1 if standing) + soldiers×1 + tanks×2 + turrets×2
 */
export function attackPower(soldiers: number, tanks = 0): number {
  return Math.max(0, soldiers) + Math.max(0, tanks) * 3;
}

export function defensePower(p: {
  soldiers: number;
  tanks?: number;
  buildings: Building[];
  house?: LatLng | null;
  houseHp?: number;
}): number {
  const houseUp = Boolean(p.house) && (p.houseHp ?? 0) > 0;
  const turrets = p.buildings.filter((b) => b.type === "turret").length;
  return (
    (houseUp ? 1 : 0) +
    Math.max(0, p.soldiers) +
    Math.max(0, p.tanks || 0) * 2 +
    turrets * 2
  );
}

/** Human-readable breakdown for HUD / battle reports */
export function attackBreakdown(soldiers: number, tanks = 0): string {
  const parts = [
    soldiers > 0 ? `${soldiers} soldier${soldiers === 1 ? "" : "s"}` : null,
    tanks > 0 ? `${tanks} tank${tanks === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" + ") : "no army";
}

export function defenseBreakdown(p: {
  soldiers: number;
  tanks?: number;
  buildings: Building[];
  house?: LatLng | null;
  houseHp?: number;
}): string {
  const houseUp = Boolean(p.house) && (p.houseHp ?? 0) > 0;
  const turrets = p.buildings.filter((b) => b.type === "turret").length;
  const parts = [
    houseUp ? "house" : null,
    p.soldiers > 0
      ? `${p.soldiers} soldier${p.soldiers === 1 ? "" : "s"}`
      : null,
    (p.tanks || 0) > 0
      ? `${p.tanks} tank${p.tanks === 1 ? "" : "s"}`
      : null,
    turrets > 0 ? `${turrets} turret${turrets === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" + ") : "no defense";
}
