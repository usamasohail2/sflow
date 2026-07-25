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
  /** Permanent home — set once, never changed */
  homeSectorId: string | null;
  house: LatLng | null;
  villagers: number;
  soldiers: number;
  tanks: number;
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
  updatedAt: number;
};

export type PublicPlayer = {
  id: string;
  name: string;
  homeSectorId: string | null;
  house: LatLng | null;
  villagers: number;
  soldiers: number;
  tanks: number;
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
  destroyed: string | null;
  soldiersLost: number;
  tanksLost: number;
  defenderSoldiersLost: number;
};

export type GameSnapshot = {
  sectors: Sector[];
  spots: ResourceSpot[];
  players: PublicPlayer[];
  me: Player | null;
  serverNow: number;
  gatherTripMs: number;
  buildingCatalog: BuildingCatalogItem[];
  authDisabled: boolean;
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

export const SOLDIER_COST = 30;
export const TANK_COST = 90;
export const ATTACK_COOLDOWN_MS = 60_000;

export const BUILDING_CATALOG: BuildingCatalogItem[] = [
  {
    type: "mill",
    name: "Grain mill",
    cost: 35,
    blurb: "+2 gold each trip",
    tripBonus: 2,
    footprintM: 34,
    hp: 120,
    defense: 0,
  },
  {
    type: "warehouse",
    name: "Warehouse",
    cost: 55,
    blurb: "+3 gold each trip",
    tripBonus: 3,
    footprintM: 42,
    hp: 160,
    defense: 0,
  },
  {
    type: "well",
    name: "Village well",
    cost: 45,
    blurb: "+2 gold each trip",
    tripBonus: 2,
    footprintM: 26,
    hp: 100,
    defense: 0,
  },
  {
    type: "turret",
    name: "Guard turret",
    cost: 60,
    blurb: "Defends your sector (+25 def)",
    tripBonus: 0,
    footprintM: 22,
    hp: 150,
    defense: 25,
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

export function defensePower(p: {
  soldiers: number;
  tanks?: number;
  buildings: Building[];
}): number {
  const turrets = p.buildings.filter((b) => b.type === "turret").length;
  return 15 + p.soldiers * 10 + (p.tanks || 0) * 30 + turrets * 25;
}

export function attackPower(soldiers: number, tanks = 0): number {
  return soldiers * 10 + tanks * 40;
}
