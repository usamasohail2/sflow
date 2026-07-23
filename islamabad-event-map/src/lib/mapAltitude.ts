import { MercatorCoordinate, type Map as MapboxMap } from "mapbox-gl";

type TransformWithCoordinatePoint = {
  _coordinatePoint?: (
    coord: MercatorCoordinate,
    sampleTerrainIn3D: boolean
  ) => { x: number; y: number };
};

/** Terrain / ground elevation in meters (ellipsoid), or null if unavailable */
export function queryGroundElevation(
  map: MapboxMap,
  lng: number,
  lat: number
): number | null {
  try {
    const elev = map.queryTerrainElevation?.({ lng, lat }, { exaggerated: true });
    if (typeof elev === "number" && Number.isFinite(elev)) return elev;
  } catch {
    // terrain not ready
  }
  return null;
}

/** Project lng/lat/altitude (meters above ellipsoid) to screen pixels */
export function projectLngLatAltitude(
  map: MapboxMap,
  lng: number,
  lat: number,
  altitude = 0
): { x: number; y: number } | null {
  try {
    const merc = MercatorCoordinate.fromLngLat({ lng, lat }, altitude);
    const tr = map.transform as unknown as TransformWithCoordinatePoint;
    if (typeof tr._coordinatePoint === "function") {
      // false = use the altitude we passed, don't resample terrain
      const point = tr._coordinatePoint(merc, false);
      if (
        point &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y)
      ) {
        return { x: point.x, y: point.y };
      }
    }

    // Fallback: approximate screen lift from pitch + zoom
    const ground = map.project([lng, lat]);
    const pitch = (map.getPitch() * Math.PI) / 180;
    const zoom = map.getZoom();
    const metersPerPx =
      (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
    const dy = (altitude / Math.max(metersPerPx, 0.01)) * Math.sin(pitch);
    return { x: ground.x, y: ground.y - dy };
  } catch {
    return null;
  }
}

/**
 * Pixel offset from ground anchor → elevated position (for Mapbox Marker offset).
 * `heightAboveGround` is meters above the local terrain / ground plane.
 */
export function altitudeMarkerOffset(
  map: MapboxMap,
  lng: number,
  lat: number,
  heightAboveGround = 0
): [number, number] {
  if (!heightAboveGround || heightAboveGround <= 0) return [0, 0];
  const groundElev = queryGroundElevation(map, lng, lat) ?? 0;
  const absoluteAlt = groundElev + heightAboveGround;
  const ground = map.project([lng, lat]);
  const elevated = projectLngLatAltitude(map, lng, lat, absoluteAlt);
  if (!elevated) return [0, 0];
  return [elevated.x - ground.x, elevated.y - ground.y];
}

/** Read free-camera eye altitude in meters (above ellipsoid) */
export function readCameraAltitude(map: MapboxMap): number | undefined {
  try {
    const camera = map.getFreeCameraOptions?.();
    const alt = camera?.position?.toAltitude?.();
    if (typeof alt === "number" && Number.isFinite(alt) && alt >= 0) {
      return alt;
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Camera eye height above local ground/terrain (meters AGL).
 * Falls back to ellipsoid altitude when terrain isn't available yet.
 */
export function readHeightAboveGround(
  map: MapboxMap,
  lng?: number,
  lat?: number
): number | undefined {
  const eyeAlt = readCameraAltitude(map);
  if (eyeAlt == null) return undefined;

  const center = map.getCenter();
  const atLng = typeof lng === "number" ? lng : center.lng;
  const atLat = typeof lat === "number" ? lat : center.lat;
  const ground = queryGroundElevation(map, atLng, atLat);
  if (ground == null) {
    // Terrain not ready — still publish ellipsoid height so Z isn't lost.
    // Once DEM loads, subsequent beats will convert to true AGL.
    return eyeAlt;
  }
  return Math.max(0, eyeAlt - ground);
}
