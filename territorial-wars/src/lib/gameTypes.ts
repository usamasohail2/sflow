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
export const EXPLORE_ZOOM = 15.2;
/** Mid play zoom — sector walls readable */
export const PLAY_ZOOM = 14.4;
/** Default 3D tilt — matches Islamabad Explore */
export const PLAY_PITCH = 77;
/** Default heading (clockwise from north) — matches Islamabad Explore */
export const PLAY_BEARING = -28;
/** Don't pull out past a couple of sectors */
export const PLAY_MIN_ZOOM = 13.2;
/** Splash: whole Islamabad in frame */
export const INTRO_CITY_ZOOM = 11.7;
/** Intro step 1: sector overview after leaving the city frame */
export const INTRO_MID_ZOOM = 14.3;
/** Intro step 2 / play land: close enough to see villagers */
export const INTRO_CLOSE_ZOOM = 16.5;
/** Islamabad overview center for the splash frame */
export const INTRO_CITY_CENTER = { lat: 33.6844, lng: 73.0479 } as const;
/** Hold on the city splash so the title can read */
export const INTRO_TITLE_HOLD_MS = 1400;
/** City → sector (step 1) */
export const INTRO_FLY1_MS = 2000;
/** Brief beat on the sector before diving to villagers */
export const INTRO_MID_HOLD_MS = 350;
/** Sector → villager-close (step 2) */
export const INTRO_FLY2_MS = 2200;
/** @deprecated use INTRO_CITY_ZOOM — kept for any stray imports */
export const INTRO_GLOBE_ZOOM = INTRO_CITY_ZOOM;
/** @deprecated total of both fly legs */
export const INTRO_FLY_MS = INTRO_FLY1_MS + INTRO_MID_HOLD_MS + INTRO_FLY2_MS;
/**
 * At/above this zoom Mapbox 3D buildings read clearly — show houses,
 * villagers, and settlement detail. Below it: dots + sector economy only.
 */
export const DETAIL_ZOOM = 15.0;
/** Street-close ceiling — tight enough for house/villager detail */
export const PLAY_MAX_ZOOM = 18.5;
/** How far (m) you must roam while zoomed before a gem can appear */
export const ROAM_METERS_TO_SPAWN = 90;
/** Must stay exploring (zoomed in, in sector) this long before a find */
export const ROAM_MIN_EXPLORE_MS = 8_000;
/** Min time between roam spawns */
export const SPAWN_COOLDOWN_MS = 22_000;
/** Cap finds spawned in a sector */
export const MAX_ROAM_FINDS = 14;

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
  /** Consumable attack munitions — expended when you raid */
  rockets: number;
  /** Highest rocket count reached — arsenal bar shows current/peak */
  peakRockets: number;
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
  rockets: number;
  peakRockets: number;
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
  rocketsLost: number;
  defenderRocketsLost: number;
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
  /** Optional — present on newer battle events */
  attackPower?: number;
  defensePower?: number;
  rocketsLost?: number;
  defenderRocketsLost?: number;
  /** Legacy army fields — older events only */
  soldiersLost?: number;
  tanksLost?: number;
  defenderSoldiersLost?: number;
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
  /** How many players joined with my invite code */
  inviteCount: number;
  /** True while a tutorial-test backup is held for this player */
  tutorialTestActive: boolean;
};

/** One gather trip duration — villager walk loop matches this */
export const GATHER_TRIP_MS = 4000;

export const STARTING = {
  villagers: 1,
  gold: 0,
} as const;

/** Coin glyph for gold amounts — never use a trailing "g" (reads as kg) */
export const GOLD_COIN = "🪙";

export const INVITE_VILLAGER_BONUS = 1;

/** House ground radius (m) for overlap checks */
export const HOUSE_FOOTPRINT_M = 30;

/** Simple house HP — each attack point chips 1 HP */
export const HOUSE_MAX_HP = 5;

/** Gold to stock one rocket in your arsenal */
export const ROCKET_COST = 35;
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
 *  Attack = rockets×1 (munitions you fire — expended after the raid)
 *  Defense = house(1 if standing) + turrets×2
 */
export function attackPower(rockets: number): number {
  return Math.max(0, rockets);
}

export function defensePower(p: {
  buildings: Building[];
  house?: LatLng | null;
  houseHp?: number;
}): number {
  const houseUp = Boolean(p.house) && (p.houseHp ?? 0) > 0;
  const turrets = p.buildings.filter((b) => b.type === "turret").length;
  return (houseUp ? 1 : 0) + turrets * 2;
}

/** Human-readable breakdown for HUD / battle reports */
export function attackBreakdown(rockets: number): string {
  if (rockets <= 0) return "no rockets";
  return `${rockets} rocket${rockets === 1 ? "" : "s"}`;
}

export function defenseBreakdown(p: {
  buildings: Building[];
  house?: LatLng | null;
  houseHp?: number;
}): string {
  const houseUp = Boolean(p.house) && (p.houseHp ?? 0) > 0;
  const turrets = p.buildings.filter((b) => b.type === "turret").length;
  const parts = [
    houseUp ? "house" : null,
    turrets > 0 ? `${turrets} turret${turrets === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" + ") : "no defense";
}
