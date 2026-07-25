import type { GemType, LatLng, ResourceSpot, Sector } from "@/lib/gameTypes";
import { GEM_META } from "@/lib/gameTypes";
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

/** Move `meters` along Mapbox bearing (degrees clockwise from north). */
export function offsetBearing(
  origin: LatLng,
  bearingDeg: number,
  meters: number
): LatLng {
  const rad = (bearingDeg * Math.PI) / 180;
  const north = Math.cos(rad) * meters;
  const east = Math.sin(rad) * meters;
  return offsetMeters(origin, east, north);
}

export function distMeters(a: LatLng, b: LatLng): number {
  const x =
    (a.lng - b.lng) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const y = (a.lat - b.lat) * 111_320;
  return Math.hypot(x, y);
}

/** Stable 32-bit hash for deterministic trip targets */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededUnit(seed: number, salt: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Deterministic point inside a sector ring (rejection in bbox). */
export function seededPointInRing(
  ring: [number, number][],
  seed: number,
  attempt = 0
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
  for (let i = 0; i < 16; i++) {
    const u = seededUnit(seed, attempt * 17 + i * 3 + 1);
    const v = seededUnit(seed, attempt * 17 + i * 3 + 2);
    const lng = minLng + u * (maxLng - minLng);
    const lat = minLat + v * (maxLat - minLat);
    if (pointInRing({ lat, lng }, ring)) return { lat, lng };
  }
  return null;
}

/**
 * Pick a farm site for this gather trip — cycles easy nodes and
 * random-looking points elsewhere in the sector so paths vary.
 */
export function farmTargetForTrip(
  ring: [number, number][],
  origin: LatLng,
  easySpots: LatLng[],
  tripKey: string
): LatLng {
  const seed = hashSeed(tripKey);
  const useEasy = easySpots.length > 0 && seededUnit(seed, 0) < 0.55;
  if (useEasy) {
    const idx = Math.floor(seededUnit(seed, 1) * easySpots.length);
    return easySpots[idx] ?? easySpots[0]!;
  }
  for (let i = 0; i < 28; i++) {
    const pt = seededPointInRing(ring, seed, i);
    if (!pt) continue;
    const d = distMeters(pt, origin);
    // Stay in the sector but away from the house post
    if (d >= 28 && d <= 220) return pt;
  }
  // Fallback: fan out around the post at a few bearings
  const bearing = seededUnit(seed, 9) * 360;
  const dist = 45 + seededUnit(seed, 10) * 70;
  const fallback = offsetBearing(origin, bearing, dist);
  return pointInRing(fallback, ring) ? fallback : offsetMeters(origin, 40, 24);
}

export function pickRoamGem(): GemType {
  const roll = Math.random();
  if (roll < 0.12) return "diamond";
  if (roll < 0.3) return "ruby";
  if (roll < 0.55) return "sapphire";
  return "emerald";
}

/**
 * Seed only nearby easy gems at the house.
 * Rare gems spawn later when the player roams zoomed-in.
 */
export function seedSpotsForSector(
  sector: Sector,
  house: LatLng,
  existing: ResourceSpot[]
): ResourceSpot[] {
  const others = existing.filter((s) => s.sectorId !== sector.id);
  const mine = existing.filter((s) => s.sectorId === sector.id);
  if (mine.some((s) => s.kind === "easy")) {
    // Drop legacy pre-placed hiddens; starter nodes become wood/stone
    const cleaned = mine
      .filter((s) => s.kind === "easy" || Boolean(s.ownerId))
      .map((s) => {
        if (s.kind !== "easy") return s;
        const gem: GemType = s.id.endsWith("_easy_0") ? "wood" : "stone";
        return { ...s, gem, yield: GEM_META[gem].yield, refillMs: 0 };
      });
    return [...others, ...cleaned];
  }

  const easy: ResourceSpot[] = [];
  // Starter nodes by the house — a wood grove and a stone pile
  const easyPlan: { e: number; n: number; gem: GemType }[] = [
    { e: 42, n: 24, gem: "wood" },
    { e: -36, n: 30, gem: "stone" },
  ];
  easyPlan.forEach(({ e, n, gem }, i) => {
    let p = offsetMeters(house, e, n);
    if (!pointInRing(p, sector.ring)) p = house;
    easy.push({
      id: `${sector.id}_easy_${i}`,
      sectorId: sector.id,
      kind: "easy",
      gem,
      lat: p.lat,
      lng: p.lng,
      yield: GEM_META[gem].yield,
      refillMs: 0,
      availableAt: 0,
    });
  });

  const keptFinds = mine.filter((s) => s.kind === "hidden" && s.ownerId);
  return [...others, ...easy, ...keptFinds];
}

export function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}
