import type { LatLng } from "@/lib/gameTypes";

/**
 * World entities that roam / park / drain — CDA trucks, spy sats, and
 * future NPCs share this shape.
 */
export type WorldNpcKind =
  | "cda_hq"
  | "cda_truck"
  | "spy_sat"
  | "tax_collector"
  | "merchant"
  | "saboteur"
  | "bounty_hunter"
  | "recruiter"
  | "diplomat";

export type WorldNpcPhase =
  | "idle"
  | "traveling"
  | "parked"
  | "fleeing"
  | "active"
  | "gone";

export type WorldNpc = {
  id: string;
  kind: WorldNpcKind;
  lat: number;
  lng: number;
  phase: WorldNpcPhase;
  label?: string;
  /** Travel origin */
  fromLat?: number;
  fromLng?: number;
  /** Travel destination */
  toLat?: number;
  toLng?: number;
  departAt?: number;
  arriveAt?: number;
  /** Victim / host (truck drain target, sat defender) */
  targetPlayerId?: string | null;
  targetName?: string | null;
  /** Who planted / sent this (spy sat planter) */
  ownerPlayerId?: string | null;
  ownerName?: string | null;
  sectorId?: string | null;
  lastDrainAt?: number;
  drainedTotal?: number;
  /** Spy sat: when first noticed by the defender (banner start) */
  noticedAt?: number;
  createdAt: number;
  updatedAt: number;
};

/** Gold to plant a spy satellite in an enemy sector */
export const SPY_SAT_COST = 55;
/** Gold drained per minute while a sat is active */
export const SPY_SAT_DRAIN_PER_MIN = 2;
/** Gold drained per minute while a CDA truck is parked */
export const CDA_TRUCK_DRAIN_PER_MIN = 4;
/** Min hours between CDA truck dispatches (≈2–3 / day) */
export const CDA_TRUCK_MIN_GAP_MS = 7 * 60 * 60 * 1000;
/** Max hours between dispatches */
export const CDA_TRUCK_MAX_GAP_MS = 12 * 60 * 60 * 1000;
/** Travel duration HQ → sector (ms) */
export const CDA_TRUCK_TRAVEL_MS = 75_000;
/** How long a truck stays parked draining before leaving on its own */
export const CDA_TRUCK_PARK_MS = 8 * 60 * 1000;
/** Tap range to chase off a parked truck (meters) */
export const CDA_CHASE_RANGE_M = 220;
/** Tap / destroy range for spy sats (meters) */
export const SPY_SAT_DESTROY_RANGE_M = 80;

export function worldNpcPos(n: WorldNpc): LatLng {
  return { lat: n.lat, lng: n.lng };
}

/** Interpolate travel for client + server ticks. */
export function worldNpcTravelPos(
  n: WorldNpc,
  now = Date.now()
): LatLng {
  if (
    (n.phase === "traveling" || n.phase === "fleeing") &&
    n.fromLat != null &&
    n.fromLng != null &&
    n.toLat != null &&
    n.toLng != null &&
    n.departAt != null &&
    n.arriveAt != null &&
    n.arriveAt > n.departAt
  ) {
    const t = Math.max(
      0,
      Math.min(1, (now - n.departAt) / (n.arriveAt - n.departAt))
    );
    // Ease in-out for a truck-y feel
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    return {
      lat: n.fromLat + (n.toLat - n.fromLat) * e,
      lng: n.fromLng + (n.toLng - n.fromLng) * e,
    };
  }
  return { lat: n.lat, lng: n.lng };
}

export function isSpySat(n: WorldNpc): boolean {
  return n.kind === "spy_sat" && n.phase === "active";
}

export function isCdaTruck(n: WorldNpc): boolean {
  return n.kind === "cda_truck" && n.phase !== "gone";
}

export function isCdaHq(n: WorldNpc): boolean {
  return n.kind === "cda_hq";
}
