import type { Map as MapboxMap } from "mapbox-gl";

const TERRAIN_SOURCE = "mapbox-dem";

/**
 * Mapbox Standard's `load` / `style.load` can fire before imported basemap
 * fragments finish. Mutating the style (terrain, config) too early can leave
 * the map permanently blank (0 layers, no tiles). Wait until fully ready.
 */
export function whenStyleReady(
  map: MapboxMap,
  callback: () => void,
  timeoutMs = 12000
): () => void {
  let done = false;
  let raf = 0;
  let timer = 0;

  const finish = () => {
    if (done) return;
    done = true;
    window.cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    map.off("idle", onIdle);
    callback();
  };

  const onIdle = () => {
    if (map.isStyleLoaded()) finish();
  };

  const poll = () => {
    if (done) return;
    if (map.isStyleLoaded()) {
      finish();
      return;
    }
    raf = window.requestAnimationFrame(poll);
  };

  if (map.isStyleLoaded()) {
    callback();
    return () => {
      done = true;
    };
  }

  map.on("idle", onIdle);
  raf = window.requestAnimationFrame(poll);
  timer = window.setTimeout(finish, timeoutMs);

  return () => {
    done = true;
    window.cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    map.off("idle", onIdle);
  };
}

/** What the Layers panel can toggle on the basemap */
export interface MapBasemapOptions {
  placeLabels: boolean;
  roadLabels: boolean;
  poiLabels: boolean;
  transitLabels: boolean;
  pedestrianRoads: boolean;
  roadsAndTransit: boolean;
  buildings3d: boolean;
}

export const DEFAULT_BASEMAP_OPTIONS: MapBasemapOptions = {
  placeLabels: true,
  roadLabels: false,
  poiLabels: false,
  transitLabels: false,
  pedestrianRoads: false,
  roadsAndTransit: true,
  buildings3d: true,
};

/**
 * Place-label names to hide individually (Mapbox Standard `hide` feature state).
 * Matching is case-insensitive; punctuation/extra spaces are ignored.
 */
export const HIDDEN_PLACE_LABELS = [
  "CHOUR HARPAL",
] as const;

function normalizePlaceName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const HIDDEN_PLACE_SET = new Set(
  HIDDEN_PLACE_LABELS.map((n) => normalizePlaceName(n))
);

/**
 * Hide specific place labels (e.g. "CHOUR HARPAL") while leaving the rest visible.
 * Re-run on `idle` / after pan-zoom — only rendered features can receive feature state.
 */
export function hideBlockedPlaceLabels(map: MapboxMap) {
  if (!map.getStyle()?.imports) return;
  try {
    const features = map.queryRenderedFeatures({
      target: { featuresetId: "place-labels", importId: "basemap" },
    } as Parameters<MapboxMap["queryRenderedFeatures"]>[0]);

    for (const feature of features) {
      const name = String(
        (feature.properties as { name?: string } | null)?.name ?? ""
      );
      if (!name || !HIDDEN_PLACE_SET.has(normalizePlaceName(name))) continue;
      map.setFeatureState(feature, { hide: true });
    }
  } catch {
    // Featureset query unsupported / style not ready
  }
}

/** Enable elevation terrain on the map (Margalla Hills, etc.) */
export function enableMapTerrain(map: MapboxMap, exaggeration = 1.25) {
  if (!map.getSource(TERRAIN_SOURCE)) {
    map.addSource(TERRAIN_SOURCE, {
      type: "raster-dem",
      url: "mapbox://mapbox.mapbox-terrain-dem-v1",
      tileSize: 512,
      maxzoom: 14,
    });
  }
  map.setTerrain({ source: TERRAIN_SOURCE, exaggeration });
}

export function disableMapTerrain(map: MapboxMap) {
  map.setTerrain(null);
}

/** Atmosphere tuned to match Standard light presets (day / dusk / night) */
const FOG_BY_THEME: Record<
  "light" | "dusk" | "dark",
  {
    range: [number, number];
    color: string;
    "high-color": string;
    "horizon-blend": number;
    "space-color": string;
    "star-intensity": number;
  }
> = {
  light: {
    range: [0.8, 12],
    color: "rgb(186, 210, 235)",
    "high-color": "rgb(36, 92, 223)",
    "horizon-blend": 0.08,
    "space-color": "rgb(210, 225, 240)",
    "star-intensity": 0,
  },
  dusk: {
    // Wide horizon-blend so the warm band fades into space instead of a hard cut
    range: [0.5, 12],
    color: "rgb(110, 65, 70)",
    "high-color": "rgb(95, 50, 75)",
    "horizon-blend": 0.48,
    "space-color": "rgb(22, 12, 28)",
    "star-intensity": 0.22,
  },
  dark: {
    range: [0.5, 10],
    color: "rgb(18, 28, 48)",
    "high-color": "rgb(8, 14, 40)",
    "horizon-blend": 0.1,
    "space-color": "rgb(2, 4, 12)",
    "star-intensity": 0.55,
  },
};

/** Hide fog, or restore atmosphere matched to the current theme */
export function setMapFogEnabled(
  map: MapboxMap,
  enabled: boolean,
  theme: "light" | "dusk" | "dark" = "light"
) {
  try {
    if (!enabled) {
      map.setFog(null);
      return;
    }
    map.setFog(FOG_BY_THEME[theme]);
  } catch {
    // Style may not support fog
  }
}

/** Mapbox Standard lightPreset for the app theme */
export function standardLightPreset(
  theme: "light" | "dusk" | "dark"
): "day" | "dusk" | "night" {
  if (theme === "dark") return "night";
  if (theme === "dusk") return "dusk";
  return "day";
}

/** Match Mapbox Standard basemap to app theme */
export function setStandardLightPreset(
  map: MapboxMap,
  theme: "light" | "dusk" | "dark"
) {
  if (!map.getStyle()?.imports) return;
  try {
    map.setConfigProperty("basemap", "lightPreset", standardLightPreset(theme));
  } catch {
    // Style may not be Standard — ignore
  }
}

function setBasemapFlag(
  map: MapboxMap,
  key: string,
  value: boolean
) {
  try {
    map.setConfigProperty("basemap", key, value);
  } catch {
    // Property may not exist on this Standard version
  }
}

/**
 * Apply Layers-panel options to Mapbox Standard via config properties.
 * (Place-label *size* isn't configurable on Standard — only on/off.)
 */
export function applyStandardBasemapOptions(
  map: MapboxMap,
  options: MapBasemapOptions
) {
  if (!map.getStyle()?.imports) return;
  setBasemapFlag(map, "showPlaceLabels", options.placeLabels);
  setBasemapFlag(map, "showRoadLabels", options.roadLabels);
  setBasemapFlag(map, "showPointOfInterestLabels", options.poiLabels);
  setBasemapFlag(map, "showTransitLabels", options.transitLabels);
  setBasemapFlag(map, "showPedestrianRoads", options.pedestrianRoads);
  setBasemapFlag(map, "showRoadsAndTransit", options.roadsAndTransit);
  setBasemapFlag(map, "show3dObjects", options.buildings3d);
}

/** Best-effort layer visibility for legacy streets/dark styles (2D mode) */
export function applyLegacyBasemapOptions(
  map: MapboxMap,
  options: MapBasemapOptions
) {
  try {
    const layers = map.getStyle()?.layers ?? [];
    for (const layer of layers) {
      if (!map.getLayer(layer.id)) continue;
      const id = layer.id.toLowerCase();

      let visible: boolean | null = null;

      if (
        id.includes("place") ||
        id.includes("settlement") ||
        id.includes("country") ||
        id.includes("state")
      ) {
        visible = options.placeLabels;
      } else if (
        id.includes("poi") ||
        id.includes("airport") ||
        id.includes("attraction")
      ) {
        visible = options.poiLabels;
      } else if (
        id.includes("transit") ||
        id.includes("rail") ||
        id.includes("ferry") ||
        id.includes("aerialway")
      ) {
        if (layer.type === "symbol") {
          visible = options.transitLabels;
        } else {
          visible = options.roadsAndTransit;
        }
      } else if (
        id.includes("road") &&
        (id.includes("label") || id.includes("shield") || layer.type === "symbol")
      ) {
        visible = options.roadLabels;
      } else if (
        id.includes("path") ||
        id.includes("pedestrian") ||
        id.includes("footway") ||
        id.includes("steps")
      ) {
        visible = options.pedestrianRoads;
      } else if (
        id.includes("road") ||
        id.includes("street") ||
        id.includes("bridge") ||
        id.includes("tunnel") ||
        id.includes("motorway")
      ) {
        visible = options.roadsAndTransit;
      } else if (
        id.includes("building") ||
        id.includes("extrusion")
      ) {
        visible = options.buildings3d;
      }

      if (visible == null) continue;
      map.setLayoutProperty(
        layer.id,
        "visibility",
        visible ? "visible" : "none"
      );
    }
  } catch {
    // ignore
  }
}

/** @deprecated Prefer applyStandardBasemapOptions with DEFAULT_BASEMAP_OPTIONS */
export function reduceStandardLabels(map: MapboxMap) {
  applyStandardBasemapOptions(map, DEFAULT_BASEMAP_OPTIONS);
}

/** @deprecated Prefer applyLegacyBasemapOptions with DEFAULT_BASEMAP_OPTIONS */
export function reduceLegacyLabels(map: MapboxMap) {
  applyLegacyBasemapOptions(map, DEFAULT_BASEMAP_OPTIONS);
}
