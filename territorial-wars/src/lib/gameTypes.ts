export type LatLng = {
  lat: number;
  lng: number;
};

export type Sector = {
  id: string;
  name: string;
  /** Ring of [lng, lat] — first point equals last */
  ring: [number, number][];
  createdAt: number;
  updatedAt: number;
};

export type Player = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  inviteCode: string;
  invitedBy: string | null;
  /** Personal gold dug by this player's villagers */
  gold: number;
  villagers: number;
  houseSlots: number;
  housesPlaced: number;
  activeSectorId: string | null;
  /** Permanent dig bonus (extra gold per tick total) */
  digBonus: number;
  isBot?: boolean;
  createdAt: number;
  updatedAt: number;
};

/** Soft sector vibe meter (activity), not the spendable currency */
export type SectorEconomy = {
  sectorId: string;
  /** Lifetime digs that happened here (flavor / strength) */
  dugTotal: number;
  lastTickAt: number;
  controllerId: string | null;
};

export type GameSnapshot = {
  sectors: Sector[];
  players: Player[];
  economies: Record<string, SectorEconomy>;
  me: Player | null;
  serverNow: number;
};

/** +1 gold per villager every tick while stationed */
export const RESOURCE_TICK_MS = 500;

export const COSTS = {
  house: 25,
  villager: 40,
  digBonus: 60,
} as const;

export const STARTING = {
  gold: 0,
  villagers: 1,
  houseSlots: 3,
  housesPlaced: 0,
  digBonus: 0,
} as const;
