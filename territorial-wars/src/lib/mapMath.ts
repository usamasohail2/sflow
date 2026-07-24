import type { LatLng, ResourceSpot, Sector } from "@/lib/gameTypes";
import { pointInRing } from "@/lib/geo";

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

/** Approximate centroid of a ring */
export function ringCentroid(ring: [number, number][]): LatLng {
  const pts = ring.slice(0, -1);
  const lng = pts.reduce((s, p) => s + p[0], 0) / Math.max(1, pts.length);
  const lat = pts.reduce((s, p) => s + p[1], 0) / Math.max(1, pts.length);
  return { lat, lng };
}

/** Random point inside polygon via rejection sampling in bbox */
export function randomPointInRing(
  ring: [number, number][],
  attempts = 80
): LatLng | null {
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  for (let i = 0; i < attempts; i++) {
    const lng = rand(minLng, maxLng);
    const lat = rand(minLat, maxLat);
    if (pointInRing({ lat, lng }, ring)) return { lat, lng };
  }
  return ringCentroid(ring);
}

/** Offset from a point in meters (approx) toward a bearing */
export function offsetMeters(
  origin: LatLng,
  eastM: number,
  northM: number
): LatLng {
  const dLat = northM / 111_320;
  const dLng = eastM / (111_320 * Math.cos((origin.lat * Math.PI) / 180));
  return { lat: origin.lat + dLat, lng: origin.lng + dLng };
}

export function distMeters(a: LatLng, b: LatLng): number {
  const x =
    (a.lng - b.lng) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const y = (a.lat - b.lat) * 111_320;
  return Math.hypot(x, y);
}

/**
 * Seed easy spots near house + hidden spots deeper in the sector.
 * Called when a player claims a sector (spots are per-sector shared; discovery is per-player).
 */
export function seedSpotsForSector(
  sector: Sector,
  house: LatLng,
  existing: ResourceSpot[]
): ResourceSpot[] {
  const already = existing.filter((s) => s.sectorId === sector.id);
  if (already.length > 0) return existing;

  const spots: ResourceSpot[] = [];
  const now = Date.now();

  // 2 easy nodes near the house
  const easyOffsets: [number, number][] = [
    [40, 25],
    [-35, 30],
  ];
  easyOffsets.forEach(([e, n], i) => {
    let p = offsetMeters(house, e, n);
    if (!pointInRing(p, sector.ring)) p = house;
    spots.push({
      id: `${sector.id}_easy_${i}`,
      sectorId: sector.id,
      kind: "easy",
      lat: p.lat,
      lng: p.lng,
      yield: 2,
      refillMs: 0,
      availableAt: 0,
    });
  });

  // 4 hidden nodes scattered in the sector
  for (let i = 0; i < 4; i++) {
    let p = randomPointInRing(sector.ring);
    // Prefer not too close to house
    for (let t = 0; t < 12; t++) {
      const candidate = randomPointInRing(sector.ring);
      if (candidate && distMeters(candidate, house) > 80) {
        p = candidate;
        break;
      }
    }
    if (!p) continue;
    spots.push({
      id: `${sector.id}_hidden_${i}_${now.toString(36)}`,
      sectorId: sector.id,
      kind: "hidden",
      lat: p.lat,
      lng: p.lng,
      yield: 5,
      refillMs: 45_000,
      availableAt: 0,
    });
  }

  return [...existing, ...spots];
}

export function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}
