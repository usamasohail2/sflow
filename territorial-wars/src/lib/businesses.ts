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
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: number[] };
  layer?: { id?: string; type?: string };
  source?: string;
};

/** How far a reverse-geocode POI may sit from the tap */
const MAX_POI_DIST_M = 140;

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

function readProp(
  props: Record<string, unknown> | undefined,
  ...keys: string[]
): string | null {
  if (!props) return null;
  for (const k of keys) {
    const v = props[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Pull a named place from Mapbox rendered features at a click
 * (POI / place labels on the Standard basemap).
 */
export function businessFromRenderedFeatures(
  features: MapboxFeature[],
  fallback: LatLng
): MapBusiness | null {
  for (const f of features) {
    const layerId = (f.layer?.id || "").toLowerCase();
    const source = (f.source || "").toLowerCase();
    const looksPoi =
      layerId.includes("poi") ||
      layerId.includes("place") ||
      layerId.includes("transit") ||
      source.includes("poi") ||
      source.includes("place") ||
      typeof f.properties?.category === "string" ||
      typeof f.properties?.maki === "string" ||
      typeof f.properties?.type === "string";

    const name =
      readProp(
        f.properties,
        "name",
        "name_en",
        "name_en-US",
        "name_int",
        "text",
        "title"
      ) ||
      (typeof f.text === "string" ? f.text.trim() : null) ||
      null;

    if (!name) continue;
    // Skip pure road / admin labels unless they look like POIs
    if (
      !looksPoi &&
      (layerId.includes("road") ||
        layerId.includes("street") ||
        layerId.includes("admin") ||
        layerId.includes("boundary"))
    ) {
      continue;
    }

    let lat = fallback.lat;
    let lng = fallback.lng;
    const coords = f.geometry?.coordinates;
    if (
      f.geometry?.type === "Point" &&
      Array.isArray(coords) &&
      coords.length >= 2 &&
      typeof coords[0] === "number" &&
      typeof coords[1] === "number"
    ) {
      lng = coords[0];
      lat = coords[1];
    } else if (Array.isArray(f.center) && f.center.length >= 2) {
      lng = f.center[0]!;
      lat = f.center[1]!;
    }

    const address =
      readProp(f.properties, "address", "place_name", "full_address") ||
      undefined;
    const id =
      (typeof f.id === "string" && f.id) ||
      readProp(f.properties, "id", "mapbox_id", "wikidata") ||
      undefined;

    return {
      placeKey: businessPlaceKey({ id, name, lat, lng }),
      name,
      address,
      lat,
      lng,
    };
  }
  return null;
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
    `${at.lng},${at.lat}.json?types=poi&limit=8&access_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { features?: MapboxFeature[] };
    let best: MapBusiness | null = null;
    let bestDist = MAX_POI_DIST_M;
    for (const f of data.features ?? []) {
      const name = (
        f.text ||
        readProp(f.properties, "name") ||
        f.place_name ||
        ""
      ).trim();
      const center = f.center;
      if (!name || !center) continue;
      const lat = center[1]!;
      const lng = center[0]!;
      const d = distMeters(at, { lat, lng });
      if (d > bestDist) continue;
      bestDist = d;
      best = {
        placeKey: businessPlaceKey({ id: f.id, name, lat, lng }),
        name,
        address:
          readProp(f.properties, "address") || f.place_name || undefined,
        lat,
        lng,
      };
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * Resolve a tapped map place: prefer the label under the finger,
 * then fall back to nearby POI reverse-geocode.
 */
export async function resolveTappedPlace(
  at: LatLng,
  token: string,
  rendered: unknown[]
): Promise<MapBusiness | null> {
  const fromLabel = businessFromRenderedFeatures(
    rendered as MapboxFeature[],
    at
  );
  if (fromLabel) return fromLabel;
  return findNearbyBusiness(at, token);
}
