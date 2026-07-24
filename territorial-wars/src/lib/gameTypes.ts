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
  /** How many villagers this player controls */
  villagers: number;
  /** How many houses this player may place */
  houseSlots: number;
  /** Houses already placed (usually in active sector) */
  housesPlaced: number;
  /** The one sector this player occupies */
  activeSectorId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type SectorEconomy = {
  sectorId: string;
  resources: number;
  /** ms epoch — resource accrual anchor */
  lastTickAt: number;
};

export type GameSnapshot = {
  sectors: Sector[];
  players: Player[];
  economies: Record<string, SectorEconomy>;
  me: Player | null;
  serverNow: number;
};

/** +1 resource per villager every 500ms */
export const RESOURCE_TICK_MS = 500;
