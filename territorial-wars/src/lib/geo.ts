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
