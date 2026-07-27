export type LatLng = { lat: number; lng: number };

export type Sector = {
  id: string;
  /** Display name — usually `code` + optional `tag` */
  name: string;
  /**
   * Immutable base label (e.g. H8). Locked on first rename / normalize.
   * Falls back to `name` when missing.
   */
  code?: string;
  /** Custom suffix set by the sector's current top scorer */
  tag?: string;
  taggedBy?: string;
  taggedAt?: number;
  ring: [number, number][];
  createdAt: number;
  updatedAt: number;
};

/** Base sector code (H8, B17, …) — never includes the custom tag */
export function sectorBaseCode(s: Pick<Sector, "name" | "code">): string {
  const c = s.code?.trim();
  if (c) return c;
  return String(s.name || "").trim();
}

/** Full label shown on the map / boards */
export function sectorDisplayName(
  s: Pick<Sector, "name" | "code" | "tag">
): string {
  const code = sectorBaseCode(s);
  const tag = s.tag?.trim();
  if (!code) return tag || "Sector";
  return tag ? `${code} ${tag}` : code;
}

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
  /**
   * Contested one-shot find — visible on the map for everyone,
   * first click claims the gold and removes the spot.
   */
  claimable?: boolean;
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
/** Don't pull out past the wider Islamabad metro overview */
export const PLAY_MIN_ZOOM = 11.4;
/**
 * At/below this zoom the HUD treats the view as "fully zoomed out" —
 * sector scoreboard grows for easier reading / tapping.
 */
export const OVERVIEW_ZOOM = 12.0;
/** Intro opens far out on Earth, then flies into Islamabad */
export const INTRO_GLOBE_ZOOM = 1.15;
/** Brief city/sector frame mid-flight */
export const INTRO_CITY_ZOOM = 11.7;
/** Intro step 1 land: sector overview */
export const INTRO_MID_ZOOM = 14.3;
/** Intro step 2 / play land: close enough to see villagers */
export const INTRO_CLOSE_ZOOM = 16.5;
/** Islamabad overview center for mid intro frame */
export const INTRO_CITY_CENTER = { lat: 33.6844, lng: 73.0479 } as const;
/** Hold on the globe so the title can read */
export const INTRO_TITLE_HOLD_MS = 1400;
/** Globe → sector (step 1) */
export const INTRO_FLY1_MS = 2800;
/** Brief beat on the sector before diving to villagers */
export const INTRO_MID_HOLD_MS = 350;
/** Sector → villager-close (step 2) */
export const INTRO_FLY2_MS = 2200;
/** Total of both fly legs */
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

export type BuildingType =
  | "mill"
  | "warehouse"
  | "well"
  | "shovel"
  | "barracks"
  | "silo"
  | "civic"
  | "prado"
  | "landcruiser";

/** Flex cars — hidden until every Starter Goals quest is done */
export const FLEX_VEHICLE_TYPES: BuildingType[] = [
  "civic",
  "prado",
  "landcruiser",
];

export function isFlexVehicle(type: string): boolean {
  return (FLEX_VEHICLE_TYPES as string[]).includes(type);
}

/** True if the player has a standing building of this type */
export function hasBuilding(
  p: Pick<Player, "buildings"> | null | undefined,
  type: BuildingType
): boolean {
  return Boolean(p?.buildings?.some((b) => b.type === type && (b.hp ?? 0) > 0));
}

export function hasBarracks(p: Pick<Player, "buildings"> | null | undefined): boolean {
  return hasBuilding(p, "barracks");
}

export function hasRocketSilo(p: Pick<Player, "buildings"> | null | undefined): boolean {
  return hasBuilding(p, "silo");
}

export type Building = {
  id: string;
  type: BuildingType;
  lat: number;
  lng: number;
  hp: number;
  builtAt: number;
  /**
   * Performance tier — 1 default, up to BUILDING_MAX_LEVEL (×N output).
   * Each upgrade step costs 10× the catalog build price.
   */
  level?: number;
};

export type Player = {
  id: string;
  name: string;
  email?: string;
  image?: string | null;
  /** Distinct name/tag color assigned at account creation */
  color: string;
  /** Home sector — set once; many players may share a sector */
  homeSectorId: string | null;
  house: LatLng | null;
  /** Base hit points — 0 / missing base means rebuild required */
  houseHp: number;
  /** Circular stone walls around the base — extra armor + defense */
  fortified?: boolean;
  /** Where the villager idles / starts gather trips (player-placed) */
  villagerPost: LatLng | null;
  villagers: number;
  /** Consumable attack munitions — expended when you raid (requires rocket silo) */
  rockets: number;
  /** Highest rocket count reached — arsenal bar shows current/peak */
  peakRockets: number;
  /**
   * Barracks troops — spend to sabotage enemy buildings.
   * Named `troops` (not soldiers) to avoid clashing with legacy army→rocket migration.
   */
  troops: number;
  gold: number;
  /** Lifetime resources farmed — global ranking metric */
  totalFarmed: number;
  buildings: Building[];
  /** Hidden spots this player has found */
  discoveredSpotIds: string[];
  /** Google Maps businesses reviewed for +villager rewards */
  reviewedPlaceIds: string[];
  inviteCode: string;
  invitedBy: string | null;
  /** Anchor for gather accrual */
  lastGatherAt: number;
  /** Last time a roam-find gem spawned for this player */
  lastRoamSpawnAt: number;
  /** Attack cooldown anchor */
  lastAttackAt: number;
  /** Same-sector raze cooldown anchor */
  lastRazeAt: number;
  /** Barracks troop sabotage cooldown */
  lastTroopAt?: number;
  /** Soft pace limit for clicker-shovel taps (server-only) */
  lastShovelClickAt?: number;
  createdAt: number;
  updatedAt: number;
};

/** Starter Goals checklist (UI missions) */
export function playerGoalsComplete(
  me: Pick<
    Player,
    | "homeSectorId"
    | "gold"
    | "buildings"
    | "rockets"
    | "discoveredSpotIds"
    | "reviewedPlaceIds"
  >,
  opts: { inviteCount: number; gemsFound: number }
): boolean {
  return (
    Boolean(me.homeSectorId) &&
    me.gold > 0 &&
    opts.gemsFound >= 1 &&
    me.buildings.length >= 1 &&
    (me.rockets || 0) >= 1 &&
    opts.inviteCount >= 1 &&
    (me.reviewedPlaceIds?.length ?? 0) >= 1
  );
}

type RankablePlayer = {
  id: string;
  homeSectorId: string | null;
  totalFarmed?: number;
};

/**
 * Top scorer for a home — mapped sectors compare within that sector;
 * Azad players compete on the shared Azad board.
 */
export function topScorerIdForHome(
  players: RankablePlayer[],
  homeSectorId: string
): string | null {
  const azad = isAzadHomeId(homeSectorId);
  let topId: string | null = null;
  let topFarmed = -1;
  for (const p of players) {
    if (!p.homeSectorId) continue;
    if (azad) {
      if (!isAzadHomeId(p.homeSectorId)) continue;
    } else if (p.homeSectorId !== homeSectorId) {
      continue;
    }
    const farmed = p.totalFarmed || 0;
    if (farmed > topFarmed) {
      topFarmed = farmed;
      topId = p.id;
    }
  }
  return topId;
}

/** Civic / Prado / Cruiser — only the current #1 in your sector (or Azad board) */
export function canUnlockFlexVehicles(
  me: RankablePlayer,
  players: RankablePlayer[]
): boolean {
  if (!me.homeSectorId) return false;
  return topScorerIdForHome(players, me.homeSectorId) === me.id;
}

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
  /** Distinct name/tag color assigned at account creation */
  color: string;
  homeSectorId: string | null;
  house: LatLng | null;
  houseHp: number;
  /** Circular stone walls around the base */
  fortified?: boolean;
  /** Visible so others can see your villager on the map */
  villagerPost: LatLng | null;
  villagers: number;
  rockets: number;
  peakRockets: number;
  troops: number;
  gold: number;
  totalFarmed: number;
  buildings: Building[];
  discoveredSpotIds: string[];
  /** Account created — used for growth analytics */
  createdAt: number;
  /** Last server write (gather/build/etc.) — proxy for recent activity */
  updatedAt: number;
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

type GameEventBase = {
  id: string;
  ts: number;
  attackerId: string;
  attackerName: string;
  defenderId: string;
  defenderName: string;
  sectorId: string;
  sectorName: string;
};

/** Cross-sector rocket raid */
export type AttackEvent = GameEventBase & {
  type: "attack";
  win: boolean;
  damage: number;
  destroyed: string | null;
  lootedGold: number;
  /** Attacker's home sector at raid time (for hostile wall coloring) */
  attackerSectorId?: string;
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

/** Same-sector sabotage — clear ground by rocketing a neighbor's building */
export type RazeEvent = GameEventBase & {
  type: "raze";
  buildingId: string;
  buildingType: BuildingType;
  buildingName: string;
  /** Rockets expended on this clear */
  rocketsLost?: number;
  /** HP damage dealt */
  damage?: number;
  /** True when the building was fully destroyed */
  destroyed?: boolean;
};

/** Contested roam find claimed by someone else */
export type GemClaimEvent = GameEventBase & {
  type: "gem_claim";
  gem: GemType;
  gold: number;
  /** Claimer's home sector name (for "from X") */
  claimerSectorName: string;
};

/** CDA Raid Truck — dispatched / parked / left a settler's base */
export type CdaRaidEvent = GameEventBase & {
  type: "cda_raid";
  stage: "dispatch" | "arrive" | "leave" | "chase";
  /** Gold drained when the truck left or was chased */
  drained?: number;
  npcId?: string;
};

export type GameEvent = AttackEvent | RazeEvent | GemClaimEvent | CdaRaidEvent;

export function isAttackEvent(e: GameEvent): e is AttackEvent {
  return e.type === "attack" || (e as { type?: string }).type == null;
}

export function isRazeEvent(e: GameEvent): e is RazeEvent {
  return e.type === "raze";
}

export function isGemClaimEvent(e: GameEvent): e is GemClaimEvent {
  return e.type === "gem_claim";
}

export function isCdaRaidEvent(e: GameEvent): e is CdaRaidEvent {
  return e.type === "cda_raid";
}

/** Hourly-ish snapshot of a sector's economy for growth charts */
export type SectorStatsPoint = {
  ts: number;
  settlers: number;
  farmed: number;
  gold: number;
  villagers: number;
  buildings: number;
  rockets: number;
  spots: number;
};

/** Per-settler row inside sector analytics */
export type SectorPlayerStat = {
  id: string;
  name: string;
  color: string;
  farmed: number;
  gold: number;
  villagers: number;
  buildings: number;
  rockets: number;
  houseHp: number;
  hasHouse: boolean;
};

/** Live + historical analytics for one mapped sector */
export type SectorAnalytics = {
  sectorId: string;
  name: string;
  settlers: number;
  farmed: number;
  gold: number;
  villagers: number;
  buildings: number;
  rockets: number;
  housesUp: number;
  spotsEasy: number;
  spotsClaimable: number;
  /** Sum of easy-spot yields in the sector */
  baseYield: number;
  buildingMix: Partial<Record<BuildingType, number>>;
  players: SectorPlayerStat[];
  /** Oldest → newest growth samples */
  history: SectorStatsPoint[];
};

export type GameSnapshot = {
  sectors: Sector[];
  spots: ResourceSpot[];
  players: PublicPlayer[];
  me: Player | null;
  /** Events involving me (attacker or defender), newest last */
  events: GameEvent[];
  /** Recent world activity (raids + razes), newest last */
  globalEvents: GameEvent[];
  /** Growth timelines keyed by sector id (oldest → newest) */
  sectorHistory: Record<string, SectorStatsPoint[]>;
  /** CDA HQ, raid trucks, spy sats, and other roam NPCs */
  worldNpcs: import("@/lib/worldNpcs").WorldNpc[];
  /** Spy sats currently draining me — drives persistent banner */
  activeSpyThreats: import("@/lib/worldNpcs").WorldNpc[];
  /**
   * Active CDA raid truck (traveling or parked) — world-visible so everyone
   * sees who is being raided. Null when no truck is out.
   */
  activeRaidTruck: import("@/lib/worldNpcs").WorldNpc | null;
  serverNow: number;
  gatherTripMs: number;
  buildingCatalog: BuildingCatalogItem[];
  authDisabled: boolean;
  /** Signed-in user may edit the sector map */
  isAdmin: boolean;
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

/**
 * Off-map arena for players whose GPS isn't inside any Islamabad sector.
 * Each Azad player gets a private home id `azad_<playerId>` (no map walls).
 */
export const AZAD_HOME_PREFIX = "azad_";
export const AZAD_ARENA_NAME = "Azad Umeed Wars";
/** Soft play radius around the house — roam / build / gather stay near home */
export const AZAD_PLAY_RADIUS_M = 900;
/** Client-only placement sector id while settling into Azad (no map walls) */
export const AZAD_PENDING_ID = "azad_pending";

export function isAzadHomeId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(AZAD_HOME_PREFIX);
}

export function azadHomeIdFor(playerId: string): string {
  return `${AZAD_HOME_PREFIX}${playerId}`;
}

/** Synthetic sector used only for unbound house/villager placement */
export function makeAzadPlacementSector(center?: LatLng | null): Sector {
  return {
    id: AZAD_PENDING_ID,
    name: AZAD_ARENA_NAME,
    // Empty ring → GameMap treats placement as unbound (no walls)
    ring: center
      ? [
          [center.lng, center.lat],
          [center.lng, center.lat],
          [center.lng, center.lat],
        ]
      : [],
    createdAt: 0,
    updatedAt: 0,
  };
}

/**
 * Plain-text gold marker for toasts / map labels / API errors.
 * UI surfaces should prefer `<GoldCoinIcon />` instead.
 */
export const GOLD_COIN = "◈";

/** Compact gold for HUD badges (e.g. 85M, 1.2B). */
export function formatGoldCompact(amount: number): string {
  const n = Math.floor(amount);
  if (n >= 1_000_000_000) {
    const v = n / 1_000_000_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}B`;
  }
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (n >= 10_000) {
    const v = n / 1_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}K`;
  }
  return String(n);
}

/** Format a gold amount for plain strings (toasts, errors). */
export function formatGold(amount: number): string {
  return `${GOLD_COIN}${formatGoldCompact(amount)}`;
}

export const INVITE_VILLAGER_BONUS = 1;
/** Villagers granted for reviewing a local business on Google Maps */
export const REVIEW_VILLAGER_BONUS = 1;

/** Readable name colors on dark HUD — hashed onto each account at creation */
export const PLAYER_COLOR_PALETTE = [
  "#5eb8ff",
  "#ff6b5a",
  "#e8cf8a",
  "#8fe098",
  "#f0a868",
  "#7ed4c8",
  "#f2a0c0",
  "#b8d45a",
  "#d4a0ff",
  "#ff9e6b",
  "#6ec6ff",
  "#e8a07a",
] as const;

/** Stable color for a player id (used at create + as fallback). */
export function colorForPlayerId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PLAYER_COLOR_PALETTE[h % PLAYER_COLOR_PALETTE.length]!;
}

/** Base ground radius (m) for overlap checks */
export const HOUSE_FOOTPRINT_M = 30;

/** Unfortified base HP — each attack point chips 1 HP */
export const HOUSE_MAX_HP = 5;
/** Base HP after stone fortress walls are built */
export const FORTIFIED_HOUSE_MAX_HP = 12;
/** Defense when a standing base has no walls */
export const BASE_DEFENSE = 1;
/** Defense when stone fortress walls are up */
export const BASE_FORTIFIED_DEFENSE = 3;
/** Gold to raise circular stone walls around your base */
export const BASE_WALL_COST = 80;

/** Max HP for the player's standing base (walls raise the cap). */
export function houseMaxHp(p: {
  fortified?: boolean;
  house?: LatLng | null;
}): number {
  if (!p.house) return HOUSE_MAX_HP;
  return p.fortified ? FORTIFIED_HOUSE_MAX_HP : HOUSE_MAX_HP;
}

/** Gold to stock one rocket in your arsenal */
export const ROCKET_COST = 35;
/** Gold to recruit one barracks troop */
export const TROOP_COST = 28;
/** HP damage a single troop deals to an enemy building */
export const TROOP_DAMAGE = 2;
/** Cooldown between troop sabotage orders */
export const TROOP_COOLDOWN_MS = 12_000;
/**
 * When rockets destroy an enemy base, defender loses this fraction of gold
 * (floored), at least BASE_DESTROY_GOLD_MIN, at most BASE_DESTROY_GOLD_MAX.
 */
export const BASE_DESTROY_GOLD_FRACTION = 0.2;
export const BASE_DESTROY_GOLD_MIN = 40;
export const BASE_DESTROY_GOLD_MAX = 250;
/** Flat loot when a raid wipes buildings but the base still stands */
export const RAID_WIPE_LOOT_GOLD = 25;
/** Arsenal reload after firing rockets (raids + ally clears) */
export const ATTACK_COOLDOWN_MS = 15_000;
/** Min time between same-sector building razes */
export const RAZE_COOLDOWN_MS = 20_000;
/** Upgrade multiplies building output; costs catalog price × this */
export const BUILDING_UPGRADE_COST_MULT = 10;
/** Max building performance tier (×3 output) */
export const BUILDING_MAX_LEVEL = 3;

/**
 * Building HP uses the same small scale as attack/defense points
 * so "Attack 3 vs Defense 2 → dealt 3 damage" is readable.
 */
export const BUILDING_CATALOG: BuildingCatalogItem[] = [
  {
    type: "mill",
    name: "Grain mill",
    cost: 35,
    blurb: "Economy — +2 gold each villager trip",
    tripBonus: 2,
    footprintM: 34,
    hp: 3,
    defense: 0,
  },
  {
    type: "warehouse",
    name: "Village store",
    cost: 55,
    blurb: "Economy — +3 gold each villager trip",
    tripBonus: 3,
    footprintM: 42,
    hp: 4,
    defense: 0,
  },
  {
    type: "well",
    name: "Village well",
    cost: 45,
    blurb: "Economy — +2 gold each villager trip",
    tripBonus: 2,
    footprintM: 26,
    hp: 2,
    defense: 0,
  },
  {
    type: "shovel",
    name: "Clicker shovel",
    cost: 20,
    blurb: "Tap dig — +1 gold per click (upgrade up to ×3)",
    tripBonus: 0,
    footprintM: 20,
    hp: 2,
    defense: 0,
  },
  {
    type: "barracks",
    name: "Barracks",
    cost: 70,
    blurb: "Unlock spies + troops to sabotage enemies",
    tripBonus: 0,
    footprintM: 40,
    hp: 5,
    defense: 1,
  },
  {
    type: "silo",
    name: "Rocket silo",
    cost: 90,
    blurb: "Unlocks rocket arsenal for cross-sector raids",
    tripBonus: 0,
    footprintM: 36,
    hp: 5,
    defense: 0,
  },
  {
    type: "civic",
    name: "Honda Civic",
    cost: 85_000_000,
    blurb: "Park by your house — sector #1 only",
    tripBonus: 0,
    footprintM: 16,
    hp: 2,
    defense: 0,
  },
  {
    type: "prado",
    name: "Toyota Prado",
    cost: 150_000_000,
    blurb: "SUV flex — sector #1 only",
    tripBonus: 0,
    footprintM: 20,
    hp: 3,
    defense: 0,
  },
  {
    type: "landcruiser",
    name: "Land Cruiser",
    cost: 250_000_000,
    blurb: "Top-shelf flex — sector #1 only",
    tripBonus: 0,
    footprintM: 24,
    hp: 4,
    defense: 0,
  },
];

/** Gold looted when rockets destroy a standing base */
export function baseDestroyLoot(defenderGold: number): number {
  const pct = Math.floor(defenderGold * BASE_DESTROY_GOLD_FRACTION);
  return Math.min(
    defenderGold,
    Math.max(BASE_DESTROY_GOLD_MIN, Math.min(BASE_DESTROY_GOLD_MAX, pct))
  );
}

export function catalogItem(type: BuildingType | string): BuildingCatalogItem {
  return (
    BUILDING_CATALOG.find((b) => b.type === type) ?? BUILDING_CATALOG[0]!
  );
}

export function buildingCost(type: BuildingType): number {
  return catalogItem(type).cost;
}

/** Gold to raise a building one level (10× build price per step). */
export function buildingUpgradeCost(type: BuildingType | string): number {
  return catalogItem(type).cost * BUILDING_UPGRADE_COST_MULT;
}

export function buildingLevel(b: Pick<Building, "level">): number {
  const n = Math.floor(b.level ?? 1);
  return Math.max(1, Math.min(BUILDING_MAX_LEVEL, n || 1));
}

/** Next level after an upgrade, or null if already maxed. */
export function nextBuildingLevel(
  b: Pick<Building, "level">
): number | null {
  const level = buildingLevel(b);
  if (level >= BUILDING_MAX_LEVEL) return null;
  return level + 1;
}

/** Trip bonus for one building, including upgrade multiplier. */
export function buildingTripBonus(b: Building): number {
  return catalogItem(b.type).tripBonus * buildingLevel(b);
}

/** Gold per shovel dig click (scales with upgrade level). */
export function shovelDigYield(b: Pick<Building, "type" | "level">): number {
  if (b.type !== "shovel") return 0;
  return buildingLevel(b);
}

export function buildingBonus(buildings: Building[]): number {
  let n = 0;
  for (const b of buildings) n += buildingTripBonus(b);
  return n;
}

/**
 * Simple combat:
 *  Attack = rockets×1 (munitions you fire — expended after the raid)
 *  Defense = base (1) or fortified walls (3) when standing
 */
export function attackPower(rockets: number): number {
  return Math.max(0, rockets);
}

export function defensePower(p: {
  buildings: Building[];
  house?: LatLng | null;
  houseHp?: number;
  fortified?: boolean;
}): number {
  if (!p.house || (p.houseHp ?? 0) <= 0) return 0;
  const base = p.fortified ? BASE_FORTIFIED_DEFENSE : BASE_DEFENSE;
  let fromBuildings = 0;
  for (const b of p.buildings || []) {
    if ((b.hp ?? 0) <= 0) continue;
    fromBuildings += catalogItem(b.type).defense || 0;
  }
  return base + fromBuildings;
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
  fortified?: boolean;
}): string {
  if (!p.house || (p.houseHp ?? 0) <= 0) return "no defense";
  const parts: string[] = [p.fortified ? "fortified base" : "base"];
  const barracks = (p.buildings || []).some(
    (b) => b.type === "barracks" && (b.hp ?? 0) > 0
  );
  if (barracks) parts.push("barracks");
  return parts.join(" + ");
}
