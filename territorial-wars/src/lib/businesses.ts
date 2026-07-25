import type { LatLng } from "@/lib/gameTypes";

export type MapBusiness = {
  placeKey: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
};

type MapboxFeature = {
  id?: string | number;
  text?: string;
  place_name?: string;
  center?: [number, number];
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: number[] | number[][] | number[][][] };
  layer?: { id?: string; type?: string };
  source?: string;
};

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

function coordsFromFeature(
  f: MapboxFeature,
  fallback?: LatLng
): LatLng | null {
  const coords = f.geometry?.coordinates;
  if (
    f.geometry?.type === "Point" &&
    Array.isArray(coords) &&
    coords.length >= 2 &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number"
  ) {
    return { lng: coords[0], lat: coords[1] };
  }
  if (Array.isArray(f.center) && f.center.length >= 2) {
    return { lng: f.center[0]!, lat: f.center[1]! };
  }
  return fallback ?? null;
}

/**
 * Convert a Mapbox Standard `poi` featureset feature into a business.
 * Only named POI labels — never invent a place from a bare map tap.
 */
export function businessFromPoiFeature(
  feature: unknown,
  fallback?: LatLng
): MapBusiness | null {
  if (!feature || typeof feature !== "object") return null;
  const f = feature as MapboxFeature;
  const props = f.properties ?? {};

  const name =
    readProp(props, "name", "name_en", "name_en-US", "name_int", "text", "title") ||
    (typeof f.text === "string" ? f.text.trim() : null);
  if (!name) return null;

  const at = coordsFromFeature(f, fallback);
  if (!at) return null;

  const idRaw = f.id;
  const id =
    (typeof idRaw === "string" && idRaw) ||
    (typeof idRaw === "number" ? String(idRaw) : null) ||
    readProp(props, "mapbox_id", "wikidata", "id") ||
    undefined;

  const className = readProp(props, "class", "group", "maki", "type");
  const address =
    readProp(props, "address", "full_address", "place_name") ||
    (className ? className.replace(/_/g, " ") : undefined);

  return {
    placeKey: businessPlaceKey({ id, name, lat: at.lat, lng: at.lng }),
    name,
    address,
    lat: at.lat,
    lng: at.lng,
  };
}

/**
 * Pull a named POI from classic rendered features (non-Standard styles).
 * Ignores roads / admin labels.
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
      source.includes("poi") ||
      typeof f.properties?.category === "string" ||
      typeof f.properties?.maki === "string" ||
      typeof f.properties?.class === "string";

    if (!looksPoi) continue;
    if (
      layerId.includes("road") ||
      layerId.includes("street") ||
      layerId.includes("admin") ||
      layerId.includes("boundary") ||
      layerId.includes("place-label") ||
      layerId.includes("settlement")
    ) {
      continue;
    }

    const biz = businessFromPoiFeature(f, fallback);
    if (biz) return biz;
  }
  return null;
}

/**
 * Resolve a tapped label only — no reverse-geocode of empty map taps.
 * Prefer Mapbox Standard `poi` featureset hits, then classic POI layers.
 */
export function resolveTappedPlaceLabel(
  at: LatLng,
  rendered: unknown[],
  featuresetHits: unknown[] = []
): MapBusiness | null {
  for (const f of featuresetHits) {
    const biz = businessFromPoiFeature(f, at);
    if (biz) return biz;
  }
  return businessFromRenderedFeatures(rendered as MapboxFeature[], at);
}
