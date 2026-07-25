import type { LatLng } from "@/lib/gameTypes";

/** Ray-cast point-in-polygon. Ring is [lng, lat][], may be open or closed. */
export function pointInRing(point: LatLng, ring: [number, number][]): boolean {
  if (ring.length < 3) return false;
  const x = point.lng;
  const y = point.lat;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    const denom = yj - yi;
    if (denom === 0) continue;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / denom + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Approx meters between two lat/lng points */
function haversineMeters(a: LatLng, b: LatLng): number {
  const x =
    (a.lng - b.lng) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const y = (a.lat - b.lat) * 111_320;
  return Math.hypot(x, y);
}

/**
 * GPS-tolerant sector check: inside the ring, or within `slackM` of the boundary.
 */
export function pointInOrNearRing(
  point: LatLng,
  ring: [number, number][],
  slackM = 120
): boolean {
  if (pointInRing(point, ring)) return true;
  if (ring.length < 2) return false;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    // Sample the edge (ends + midpoint) — good enough for GPS slack
    const samples: LatLng[] = [
      { lat: a[1], lng: a[0] },
      { lat: b[1], lng: b[0] },
      { lat: (a[1] + b[1]) / 2, lng: (a[0] + b[0]) / 2 },
    ];
    for (const s of samples) {
      if (haversineMeters(point, s) <= slackM) return true;
    }
  }
  return false;
}

export function closeRing(ring: [number, number][]): [number, number][] {
  if (ring.length === 0) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

export function ringToFeature(
  id: string,
  name: string,
  ring: [number, number][]
) {
  return {
    type: "Feature" as const,
    properties: { id, name },
    geometry: {
      type: "Polygon" as const,
      coordinates: [closeRing(ring)],
    },
  };
}
