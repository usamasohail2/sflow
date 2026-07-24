export type LatLng = { lat: number; lng: number };

export type Sector = {
  id: string;
  name: string;
  ring: [number, number][];
  createdAt: number;
  updatedAt: number;
};

export type ResourceSpotKind = "easy" | "hidden";

export type ResourceSpot = {
  id: string;
  sectorId: string;
  kind: ResourceSpotKind;
  lat: number;
  lng: number;
  /** Gold granted each time a villager completes a trip involving this spot */
  yield: number;
  /** ms until a depleted hidden spot refills (easy spots never deplete) */
  refillMs: number;
  /** When this spot next becomes available (0 = available now) */
  availableAt: number;
};

export type BuildingType = "mill" | "warehouse" | "well";

export type Building = {
  id: string;
  type: BuildingType;
  lat: number;
  lng: number;
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
  gold: number;
  buildings: Building[];
  /** Hidden spots this player has found */
  discoveredSpotIds: string[];
  inviteCode: string;
  invitedBy: string | null;
  /** Anchor for gather accrual */
  lastGatherAt: number;
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
  gold: number;
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

export const BUILDING_CATALOG: BuildingCatalogItem[] = [
  {
    type: "mill",
    name: "Grain mill",
    cost: 35,
    blurb: "+2 gold each trip",
    tripBonus: 2,
  },
  {
    type: "warehouse",
    name: "Warehouse",
    cost: 55,
    blurb: "+3 gold each trip",
    tripBonus: 3,
  },
  {
    type: "well",
    name: "Village well",
    cost: 45,
    blurb: "+2 gold each trip",
    tripBonus: 2,
  },
];

export function buildingCost(type: BuildingType): number {
  return BUILDING_CATALOG.find((b) => b.type === type)?.cost ?? 999;
}

export function buildingBonus(buildings: Building[]): number {
  let n = 0;
  for (const b of buildings) {
    const cat = BUILDING_CATALOG.find((c) => c.type === b.type);
    if (cat) n += cat.tripBonus;
  }
  return n;
}
