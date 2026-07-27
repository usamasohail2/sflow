import type { BuildingType, LatLng } from "@/lib/gameTypes";
import { HOUSE_FOOTPRINT_M, catalogItem } from "@/lib/gameTypes";
import { distMeters } from "@/lib/mapMath";

export type FootprintPlayer = {
  id: string;
  name?: string;
  homeSectorId?: string | null;
  house?: LatLng | null;
  buildings: Array<{ lat: number; lng: number; type: BuildingType }>;
};

/**
 * Clear-ground check for a house drop.
 * Includes every settled structure on the map (same rings the client draws).
 * `skipPlayerId` only skips that player's own house — their buildings still block
 * when rebuilding next to leftover mills/wells.
 */
export function housePlacementError(
  pos: LatLng,
  players: FootprintPlayer[],
  skipPlayerId?: string | null
): string | null {
  for (const p of players) {
    if (!p.house && (!p.buildings || p.buildings.length === 0)) continue;

    for (const b of p.buildings || []) {
      if (
        !Number.isFinite(b.lat) ||
        !Number.isFinite(b.lng)
      ) {
        continue;
      }
      const need =
        HOUSE_FOOTPRINT_M + catalogItem(b.type).footprintM;
      if (distMeters(pos, { lat: b.lat, lng: b.lng }) < need) {
        return "That ground is occupied — pick a clear spot";
      }
    }

    if (p.house && Number.isFinite(p.house.lat) && Number.isFinite(p.house.lng)) {
      // Skip only your own standing house (rebuild); everyone else's base blocks
      if (skipPlayerId && p.id === skipPlayerId) continue;
      if (distMeters(pos, p.house) < HOUSE_FOOTPRINT_M * 2) {
        return "Too close to another base";
      }
    }
  }
  return null;
}

/**
 * Match server `buildBuilding` overlap checks (includes your own structures).
 */
export function buildingPlacementError(
  pos: LatLng,
  footprintM: number,
  players: FootprintPlayer[],
  selfId?: string | null
): string | null {
  for (const p of players) {
    for (const b of p.buildings || []) {
      if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) continue;
      if (
        distMeters(pos, { lat: b.lat, lng: b.lng }) <
        footprintM + catalogItem(b.type).footprintM
      ) {
        return p.id === selfId
          ? "Too close to your other building"
          : `Too close to ${p.name || "another settler"}'s building`;
      }
    }
    if (
      p.house &&
      Number.isFinite(p.house.lat) &&
      Number.isFinite(p.house.lng) &&
      distMeters(pos, p.house) < footprintM + HOUSE_FOOTPRINT_M
    ) {
      return p.id === selfId
        ? "Too close to your base"
        : `Too close to ${p.name || "another settler"}'s base`;
    }
  }
  return null;
}

export function isOccupiedGroundError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  return /occupied|too close|clear spot/i.test(msg);
}
