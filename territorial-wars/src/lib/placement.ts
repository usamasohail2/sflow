import type { BuildingType, LatLng } from "@/lib/gameTypes";
import { HOUSE_FOOTPRINT_M, catalogItem } from "@/lib/gameTypes";
import { distMeters } from "@/lib/mapMath";

export type FootprintPlayer = {
  id: string;
  name?: string;
  house?: LatLng | null;
  buildings: Array<{ lat: number; lng: number; type: BuildingType }>;
};

/**
 * Match server `assertClearGround` — other settlers' houses/buildings only.
 * Returns an error message when the house footprint overlaps occupied ground.
 */
export function housePlacementError(
  pos: LatLng,
  players: FootprintPlayer[],
  selfId?: string | null
): string | null {
  for (const p of players) {
    if (selfId && p.id === selfId) continue;
    for (const b of p.buildings) {
      if (
        distMeters(pos, { lat: b.lat, lng: b.lng }) <
        HOUSE_FOOTPRINT_M + catalogItem(b.type).footprintM
      ) {
        return "That ground is occupied — pick a clear spot";
      }
    }
    if (p.house && distMeters(pos, p.house) < HOUSE_FOOTPRINT_M * 2) {
      return "Too close to another house";
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
    for (const b of p.buildings) {
      if (
        distMeters(pos, { lat: b.lat, lng: b.lng }) <
        footprintM + catalogItem(b.type).footprintM
      ) {
        return p.id === selfId
          ? "Too close to your other building"
          : `Too close to ${p.name || "another settler"}'s building`;
      }
    }
    if (p.house && distMeters(pos, p.house) < footprintM + HOUSE_FOOTPRINT_M) {
      return p.id === selfId
        ? "Too close to your house"
        : `Too close to ${p.name || "another settler"}'s house`;
    }
  }
  return null;
}
