import type { LatLng } from "@/lib/gameTypes";
import { distMeters } from "@/lib/mapMath";

export type MapBusiness = {
  placeKey: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
};

type MapboxFeature = {
  id?: string;
  text?: string;
  place_name?: string;
  center?: [number, number];
  properties?: { category?: string; address?: string };
};

const MAX_POI_DIST_M = 70;

/** Stable key for one-reward-per-place tracking */
export function businessPlaceKey(b: {
  id?: string;
  name: string;
  lat: number;
  lng: number;
}): string {
  if (b.id?.trim()) return b.id.trim().slice(0, 120);
  return `${b.name.trim().toLowerCase()}|${b.lat.toFixed(4)}|${b.lng.toFixed(4)}`;
}

/** Open Google Maps on the place so the player can leave a review */
export function googleMapsReviewUrl(b: MapBusiness): string {
  const q = encodeURIComponent(`${b.name} ${b.lat},${b.lng}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/**
 * Reverse-geocode nearby POIs with Mapbox so players can tap businesses
 * in their sector without a separate Places key.
 */
export async function findNearbyBusiness(
  at: LatLng,
  token: string
): Promise<MapBusiness | null> {
  if (!token) return null;
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/` +
    `${at.lng},${at.lat}.json?types=poi&limit=6&access_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { features?: MapboxFeature[] };
    let best: MapBusiness | null = null;
    let bestDist = MAX_POI_DIST_M;
    for (const f of data.features ?? []) {
      const name = (f.text || f.place_name || "").trim();
      const center = f.center;
      if (!name || !center) continue;
      const lat = center[1];
      const lng = center[0];
      const d = distMeters(at, { lat, lng });
      if (d > bestDist) continue;
      bestDist = d;
      best = {
        placeKey: businessPlaceKey({ id: f.id, name, lat, lng }),
        name,
        address: f.properties?.address || f.place_name,
        lat,
        lng,
      };
    }
    return best;
  } catch {
    return null;
  }
}
