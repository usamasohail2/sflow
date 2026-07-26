"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import MapboxMap, { Layer, Marker, Source } from "react-map-gl/mapbox";
import type { MapMouseEvent, MapRef } from "react-map-gl/mapbox";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import type {
  Building,
  BuildingType,
  GameEvent,
  LatLng,
  Player,
  PublicPlayer,
  ResourceSpot,
  Sector,
} from "@/lib/gameTypes";
import {
  DETAIL_ZOOM,
  EXPLORE_ZOOM,
  GATHER_TRIP_MS,
  GEM_META,
  HOUSE_FOOTPRINT_M,
  HOUSE_MAX_HP,
  GOLD_COIN,
  INTRO_CITY_CENTER,
  INTRO_CLOSE_ZOOM,
  INTRO_FLY1_MS,
  INTRO_FLY2_MS,
  INTRO_GLOBE_ZOOM,
  INTRO_MID_HOLD_MS,
  INTRO_MID_ZOOM,
  INTRO_TITLE_HOLD_MS,
  PLAY_BEARING,
  PLAY_MAX_ZOOM,
  PLAY_MIN_ZOOM,
  PLAY_PITCH,
  PLAY_ZOOM,
  ROAM_METERS_TO_SPAWN,
  ROAM_MIN_EXPLORE_MS,
  SPAWN_COOLDOWN_MS,
  AZAD_ARENA_NAME,
  AZAD_PLAY_RADIUS_M,
  catalogItem,
  isAttackEvent,
  isAzadHomeId,
} from "@/lib/gameTypes";
import {
  buildingPlacementError,
  housePlacementError,
} from "@/lib/placement";
import {
  closeRing,
  pointInOrNearRing,
  pointInRing,
  wallBandMultiPolygon,
} from "@/lib/geo";

/**
 * Mapbox Standard light presets — driven by Islamabad local clock
 * (Asia/Karachi, UTC+5, no DST).
 */
export type MapLightPreset = "day" | "dusk" | "night" | "dawn";

export function lightPresetForIslamabad(now = new Date()): MapLightPreset {
  // en-GB + hourCycle h23 → "14" style hour
  const hourStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  const hour = Number.parseInt(hourStr, 10);
  if (!Number.isFinite(hour)) return "dusk";
  // Rough civil windows for Islamabad year-round
  if (hour >= 5 && hour < 7) return "dawn";
  if (hour >= 7 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

function applyMapLightPreset(
  map: { setConfigProperty: (c: string, k: string, v: unknown) => void },
  preset: MapLightPreset
) {
  try {
    map.setConfigProperty("basemap", "lightPreset", preset);
  } catch {
    /* older style / not ready */
  }
}

/** Extruded wall band thickness (meters) — lines stay on the single perimeter */
const SECTOR_WALL_M = 48;
/**
 * Single solid extrusion — shorter stub walls, plain color (no fade stack).
 * Must live in the Standard `middle` slot (not `top`) or they render flat.
 */
const SECTOR_WALL_HEIGHT_M = 180;
const SECTOR_WALL_HEIGHT_MINE_M = 200;
const SECTOR_WALL_OPACITY = 0.88;

/**
 * Street-zoom cull: only show settlers / live viewers near the camera.
 * Stops far-sector people stacking on the horizon when pitched in.
 */
const DETAIL_ENTITY_RADIUS_M = 950;
/** Live map viewers — tighter than settlers so distant chat names disappear */
const DETAIL_VIEWER_RADIUS_M = 700;
/** Overview zoom: still hide ultra-distant viewers */
const OVERVIEW_VIEWER_RADIUS_M = 4500;

/** You = blue, same-sector ally = green, other sector = enemy red */
function playerRelation(
  p: { id: string; homeSectorId: string | null },
  me: Player | null | undefined
): "self" | "ally" | "enemy" {
  if (!me || p.id === me.id) return "self";
  if (
    me.homeSectorId &&
    p.homeSectorId &&
    p.homeSectorId === me.homeSectorId
  ) {
    return "ally";
  }
  return "enemy";
}
import {
  distMeters,
  easeInOutCubic,
  farmTargetForTrip,
  lerpLatLng,
  offsetMeters,
  ringCentroid,
  rocketBezierHeadingDeg,
  rocketBezierLatLng,
} from "@/lib/mapMath";
import { setVillagerWorkLevel, stopVillagerWork } from "@/lib/sound";
import {
  GATHER_DIG_END,
  GATHER_WALK_OUT_END,
  gatherPhase,
  gatherTripIndex,
} from "@/lib/rules";
import {
  CivicSprite,
  HouseSprite,
  LandCruiserSprite,
  MillSprite,
  PradoSprite,
  RocketSprite,
  ShovelSprite,
  VillagerSprite,
  WarehouseSprite,
  WellSprite,
} from "@/components/sprites";
import { ResourceNode } from "@/components/ResourceNode";
import { ViewerMarkers } from "@/components/ViewerMarkers";
import {
  businessFromPoiFeature,
  resolveTappedPlaceLabel,
} from "@/lib/businesses";
import type { PresencePeer } from "@/lib/presenceTypes";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

export type MarchAnim = {
  from: LatLng;
  to: LatLng;
  startedAt: number;
  durationMs: number;
  /** Rockets in this salvo (staggered bezier paths) */
  count?: number;
};

export type ImpactAnim = {
  at: LatLng;
  startedAt: number;
};

const IMPACT_DURATION_MS = 1600;
/** Cap visible rockets so a huge salvo stays readable */
const MAX_VISIBLE_ROCKETS = 6;

function HpBar({
  hp,
  maxHp,
  width = 40,
}: {
  hp: number;
  maxHp: number;
  width?: number;
}) {
  const pct = Math.max(0, Math.min(100, (hp / Math.max(1, maxHp)) * 100));
  const color =
    pct > 55 ? "#5a9a63" : pct > 25 ? "#e8cf8a" : "#ff5245";
  return (
    <div
      className="hp-bar"
      style={{ width }}
      title={`${hp}/${maxHp} hp`}
    >
      <div
        className="hp-bar-fill"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

export type PlacingKind = BuildingType | "house" | "villager";

export type Placing = {
  kind: PlacingKind;
  /** Sector the placement must land inside */
  sector: Sector;
};

/** Personal space shown while dropping a villager (collision still sector-only) */
const VILLAGER_FOOTPRINT_M = 14;

function placingFootprint(kind: PlacingKind): number {
  if (kind === "house") return HOUSE_FOOTPRINT_M;
  if (kind === "villager") return VILLAGER_FOOTPRINT_M;
  return catalogItem(kind).footprintM;
}

function placingLabel(kind: PlacingKind): string {
  if (kind === "house") return "house";
  if (kind === "villager") return "villager";
  return catalogItem(kind).name.toLowerCase();
}

type Props = {
  sectors: Sector[];
  spots: ResourceSpot[];
  me: Player | null;
  players: PublicPlayer[];
  selectedId: string | null;
  placing: Placing | null;
  /** House chosen but not yet committed (during claim flow) */
  previewHouse: LatLng | null;
  /** Live GPS pin while picking / claiming a sector */
  userLocation?: LatLng | null;
  /** Increment to re-center the map on the GPS pin */
  userLocationFocus?: number;
  /** Allow dragging the settle pin (manual location pick) */
  pinDraggable?: boolean;
  onMovePin?: (lat: number, lng: number) => void;
  /** Increment to re-fly to the selected sector (e.g. leaderboard re-tap) */
  sectorFocus?: number;
  /** Increment to fly the camera back to the player's house / home sector */
  homeFocus?: number;
  march: MarchAnim | null;
  impact: ImpactAnim | null;
  onSelect: (id: string) => void;
  /** Tap another settler's house to target them (null clears) */
  onSelectPlayer?: (playerId: string | null) => void;
  selectedPlayerId?: string | null;
  /** Tap a same-sector neighbor building to clear ground */
  onSelectRaze?: (
    target: { playerId: string; buildingId: string } | null
  ) => void;
  /** Tap your own clicker shovel to dig for gold */
  onSelectShovel?: (buildingId: string) => void;
  /** Tap any of your own buildings to manage (upgrade / delete) */
  onSelectOwnBuilding?: (buildingId: string) => void;
  /** Live camera peers floating above the map */
  presencePeers?: PresencePeer[];
  presenceSelf?: {
    id: string;
    name: string;
    lat: number;
    lng: number;
    bubble?: string | null;
    bubbleAt?: number | null;
  } | null;
  onCameraReport?: (camera: { lat: number; lng: number }) => void;
  selectedRazeBuildingId?: string | null;
  onPlace?: (lat: number, lng: number) => void;
  /** Called when a house/building drop is blocked by occupied ground */
  onPlaceBlocked?: (message: string) => void;
  /** Pre-settle: tap map to drop a location pin when GPS is unavailable */
  pinDropActive?: boolean;
  onDropPin?: (lat: number, lng: number) => void;
  onSpawnFind?: (payload: {
    lat: number;
    lng: number;
    bearing: number;
    zoom: number;
    roamMeters: number;
    exploreMs: number;
  }) => boolean | Promise<boolean>;
  onCollectHidden?: (spotId: string) => void;
  /** Spot ids currently claiming on the server — show a spinner on the gem */
  claimingSpotIds?: string[];
  /** Tap a Mapbox POI / business inside the home sector */
  onSelectBusiness?: (business: {
    placeKey: string;
    name: string;
    address?: string;
    lat: number;
    lng: number;
  }) => void;
  /** Fires once when the globe → sector intro finishes */
  onIntroComplete?: () => void;
  /** Pulsing map beacon during guided house/villager placement */
  guidePulse?: boolean;
  /** Optimistic buildings currently writing to the server */
  syncingBuildingIds?: string[];
  /** Personal war log — sectors that attacked you turn red */
  events?: GameEvent[];
  className?: string;
};

function BuildingSprite({ type }: { type: Building["type"] }) {
  if (type === "mill") return <MillSprite className="h-9 w-10 drop-shadow-md" />;
  if (type === "warehouse")
    return <WarehouseSprite className="h-9 w-10 drop-shadow-md" />;
  if (type === "shovel")
    return <ShovelSprite className="h-9 w-10 drop-shadow-md" />;
  if (type === "civic")
    return <CivicSprite className="h-7 w-14 drop-shadow-md" />;
  if (type === "prado")
    return <PradoSprite className="h-7 w-14 drop-shadow-md" />;
  if (type === "landcruiser")
    return <LandCruiserSprite className="h-8 w-16 drop-shadow-md" />;
  return <WellSprite className="h-9 w-10 drop-shadow-md" />;
}

/** Anchor for overview pins when house/villager detail is hidden */
function playerAnchor(p: PublicPlayer): LatLng | null {
  if (p.house) return p.house;
  if (p.villagerPost) return p.villagerPost;
  const b = p.buildings[0];
  return b ? { lat: b.lat, lng: b.lng } : null;
}

/** Compact gold/economy label for overview sector tags */
function formatEconomy(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.max(0, Math.floor(n)));
}

/** Walk out → dig at farm site → return to base */
function walkPosition(house: LatLng, target: LatLng, phase: number): LatLng {
  if (phase < GATHER_WALK_OUT_END) {
    return lerpLatLng(house, target, phase / GATHER_WALK_OUT_END);
  }
  if (phase < GATHER_DIG_END) return target;
  return lerpLatLng(
    target,
    house,
    (phase - GATHER_DIG_END) / (1 - GATHER_DIG_END)
  );
}

function gatherPose(phase: number): "walk" | "dig" {
  if (phase >= GATHER_WALK_OUT_END && phase < GATHER_DIG_END) return "dig";
  return "walk";
}

/** Small circle polygon (meters radius) for footprint rendering */
function circleFeature(
  center: LatLng,
  radiusM: number,
  props: Record<string, unknown>
): Feature<Polygon> {
  const pts: [number, number][] = [];
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const p = offsetMeters(center, Math.cos(a) * radiusM, Math.sin(a) * radiusM);
    pts.push([p.lng, p.lat]);
  }
  return {
    type: "Feature",
    properties: props,
    geometry: { type: "Polygon", coordinates: [pts] },
  };
}

export function GameMap({
  sectors,
  spots,
  me,
  players,
  selectedId,
  placing,
  previewHouse,
  userLocation = null,
  userLocationFocus = 0,
  pinDraggable = false,
  onMovePin,
  sectorFocus = 0,
  homeFocus = 0,
  march,
  impact,
  onSelect,
  onSelectPlayer,
  selectedPlayerId = null,
  onSelectRaze,
  onSelectShovel,
  onSelectOwnBuilding,
  selectedRazeBuildingId = null,
  onPlace,
  onPlaceBlocked,
  pinDropActive = false,
  onDropPin,
  onSpawnFind,
  onCollectHidden,
  claimingSpotIds = [],
  onSelectBusiness,
  onIntroComplete,
  guidePulse = false,
  syncingBuildingIds = [],
  presencePeers = [],
  presenceSelf = null,
  onCameraReport,
  events = [],
  className = "",
}: Props) {
  const syncingSet = useMemo(
    () => new Set(syncingBuildingIds),
    [syncingBuildingIds]
  );
  const claimingSet = useMemo(
    () => new Set(claimingSpotIds),
    [claimingSpotIds]
  );
  const onIntroCompleteRef = useRef(onIntroComplete);
  onIntroCompleteRef.current = onIntroComplete;
  const onCameraReportRef = useRef(onCameraReport);
  onCameraReportRef.current = onCameraReport;
  const onSelectBusinessRef = useRef(onSelectBusiness);
  onSelectBusinessRef.current = onSelectBusiness;
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;
  const onPlaceBlockedRef = useRef(onPlaceBlocked);
  onPlaceBlockedRef.current = onPlaceBlocked;
  const playersRef = useRef(players);
  playersRef.current = players;
  const mapRef = useRef<MapRef>(null);
  const [zoom, setZoom] = useState(INTRO_GLOBE_ZOOM);
  const [mapCenter, setMapCenter] = useState<LatLng>({
    lat: INTRO_CITY_CENTER.lat,
    lng: INTRO_CITY_CENTER.lng,
  });
  const showDetail = zoom >= DETAIL_ZOOM;
  /** Keep footprints/buildings visible while settling even if zoomed out */
  const showPlaceOverlays = showDetail || Boolean(placing) || Boolean(previewHouse);
  const placingMode = Boolean(placing) || Boolean(previewHouse);
  const [now, setNow] = useState(() => Date.now());
  const [exploring, setExploring] = useState(false);
  const [spawnFlash, setSpawnFlash] = useState<string | null>(null);
  const [hover, setHover] = useState<LatLng | null>(null);
  const [mapReady, setMapReady] = useState(false);
  /** While true, minZoom is open so the globe intro can run */
  const [introActive, setIntroActive] = useState(true);
  /** Title over the globe: in → fading → gone */
  const [introTitle, setIntroTitle] = useState<"in" | "out" | "gone">("in");
  const lastCenter = useRef<LatLng | null>(null);
  const lastFlownGps = useRef<string | null>(null);
  const introStarted = useRef(false);
  const introFinished = useRef(false);
  const labelsVisible = useRef(false);
  const spawning = useRef(false);
  const roamAcc = useRef(0);
  const exploreAcc = useRef(0);
  const lastExploreTick = useRef<number | null>(null);
  const localCooldownUntil = useRef(0);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 80);
    return () => window.clearInterval(id);
  }, []);

  const isAzad = Boolean(me?.homeSectorId && isAzadHomeId(me.homeSectorId));
  const homeSector = useMemo(
    () =>
      isAzad
        ? null
        : sectors.find((s) => s.id === me?.homeSectorId) ?? null,
    [sectors, me, isAzad]
  );
  /** Sector under the camera — detail overlays only show this sector's people */
  const viewSectorId = useMemo(() => {
    if (placing?.sector?.id) return placing.sector.id;
    const hit = sectors.find((s) => pointInRing(mapCenter, s.ring));
    return hit?.id ?? null;
  }, [sectors, mapCenter, placing?.sector?.id]);
  /**
   * Street-zoom / placement: settlers in the viewed sector (or near camera).
   * Overview pins still use the full `players` list.
   */
  const detailPlayers = useMemo(() => {
    if (!showPlaceOverlays) return players;
    return players.filter((p) => {
      if (me && p.id === me.id) return true;
      if (!p.homeSectorId) return false;
      if (viewSectorId && p.homeSectorId === viewSectorId) return true;
      const at = playerAnchor(p);
      if (!at) return false;
      return distMeters(mapCenter, at) <= DETAIL_ENTITY_RADIUS_M;
    });
  }, [players, me, viewSectorId, mapCenter, showPlaceOverlays]);
  const meRef = useRef(me);
  meRef.current = me;
  const homeSectorRef = useRef(homeSector);
  homeSectorRef.current = homeSector;
  const isAzadRef = useRef(isAzad);
  isAzadRef.current = isAzad;
  const showDetailRef = useRef(showDetail);
  showDetailRef.current = showDetail;

  /** Open review modal only for a real named POI inside the play area */
  const trySelectBusiness = useCallback((biz: {
    placeKey: string;
    name: string;
    address?: string;
    lat: number;
    lng: number;
  }) => {
    const select = onSelectBusinessRef.current;
    const player = meRef.current;
    if (!select || !player?.homeSectorId || !showDetailRef.current) return false;

    if (isAzadRef.current) {
      if (
        !player.house ||
        distMeters({ lat: biz.lat, lng: biz.lng }, player.house) >
          AZAD_PLAY_RADIUS_M
      ) {
        return false;
      }
    } else {
      const home = homeSectorRef.current;
      if (
        !home ||
        !pointInOrNearRing({ lat: biz.lat, lng: biz.lng }, home.ring, 120)
      ) {
        return false;
      }
    }
    select(biz);
    return true;
  }, []);

  const introFocus = useMemo((): LatLng => {
    if (me?.house) return me.house;
    if (homeSector) return ringCentroid(homeSector.ring);
    if (sectors[0]) return ringCentroid(sectors[0].ring);
    return { lat: 33.71, lng: 73.045 };
  }, [homeSector, me?.house, sectors]);
  const introFocusRef = useRef(introFocus);
  introFocusRef.current = introFocus;

  const applyBasemapLabels = useCallback((show: boolean, force = false) => {
    if (!force && labelsVisible.current === show) return;
    const ref = mapRef.current;
    if (!ref) return;
    const map = ref.getMap();
    labelsVisible.current = show;
    try {
      map.setConfigProperty("basemap", "showPlaceLabels", show);
      map.setConfigProperty("basemap", "showPointOfInterestLabels", show);
      map.setConfigProperty("basemap", "showRoadLabels", show);
      map.setConfigProperty("basemap", "showTransitLabels", show);
    } catch {
      /* style may not expose config yet */
    }
  }, []);

  /** Auto day → dusk → night (Islamabad local time); recheck each minute */
  useEffect(() => {
    if (!mapReady) return;
    const sync = () => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      applyMapLightPreset(map, lightPresetForIslamabad());
      // Light preset tweaks can drop label flags — re-assert for street zoom
      if (labelsVisible.current) applyBasemapLabels(true, true);
    };
    sync();
    const id = window.setInterval(sync, 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [mapReady, applyBasemapLabels]);

  const finishIntro = useCallback(() => {
    if (introFinished.current) return;
    introFinished.current = true;
    setIntroActive(false);
    setIntroTitle("gone");
    const map = mapRef.current;
    if (map) {
      const z = map.getZoom();
      const pitch = map.getPitch();
      const bearing = map.getBearing();
      // If intro aborted early (e.g. Strict Mode), snap to villager-close camera
      if (
        z < INTRO_CLOSE_ZOOM - 0.4 ||
        pitch < PLAY_PITCH * 0.5 ||
        Math.abs(bearing - PLAY_BEARING) > 40
      ) {
        const { lat, lng } = introFocusRef.current;
        map.easeTo({
          center: [lng, lat],
          zoom: INTRO_CLOSE_ZOOM,
          pitch: PLAY_PITCH,
          bearing: PLAY_BEARING,
          duration: 320,
        });
      }
    }
    onIntroCompleteRef.current?.();
  }, []);

  // Mapbox Standard: click real POI labels (schools, shops…) — not empty ground
  useEffect(() => {
    if (!mapReady) return;
    type InteractiveMap = {
      getCanvas: () => HTMLCanvasElement;
      addInteraction?: (
        id: string,
        spec: {
          type: string;
          target?: { featuresetId: string; importId: string };
          handler: (e: { feature?: unknown }) => boolean | void;
        }
      ) => void;
      removeInteraction?: (id: string) => void;
    };
    const map = mapRef.current?.getMap() as InteractiveMap | undefined;
    if (!map?.addInteraction) return;

    const bindPoi = (
      id: string,
      featuresetId: string,
      onFeature: (feature: unknown) => boolean
    ) => {
      map.addInteraction?.(`${id}-click`, {
        type: "click",
        target: { featuresetId, importId: "basemap" },
        handler: (e) => {
          const feature = e?.feature;
          if (!feature) return false;
          return onFeature(feature);
        },
      });
      map.addInteraction?.(`${id}-enter`, {
        type: "mouseenter",
        target: { featuresetId, importId: "basemap" },
        handler: () => {
          map.getCanvas().style.cursor = "pointer";
        },
      });
      map.addInteraction?.(`${id}-leave`, {
        type: "mouseleave",
        target: { featuresetId, importId: "basemap" },
        handler: () => {
          map.getCanvas().style.cursor = "";
        },
      });
    };

    try {
      bindPoi("itw-poi", "poi", (feature) => {
        const biz = businessFromPoiFeature(feature);
        if (!biz) return false;
        return trySelectBusiness(biz);
      });
    } catch {
      /* older GL / style without featuresets */
    }

    return () => {
      for (const id of ["itw-poi-click", "itw-poi-enter", "itw-poi-leave"]) {
        try {
          map.removeInteraction?.(id);
        } catch {
          /* ignore */
        }
      }
    };
  }, [mapReady, trySelectBusiness]);

  // Splash: outside Earth → sector → villager-close
  useEffect(() => {
    if (!mapReady || introStarted.current || introFinished.current) return;
    if (sectors.length === 0) return;
    // Wait for home geometry when settled in a mapped sector (Azad has no walls)
    if (me?.homeSectorId && !homeSector && !isAzad) return;

    introStarted.current = true;
    const map = mapRef.current;
    if (!map) return;

    const focus = introFocusRef.current;
    // Step 0 — far out on the globe with the title
    map.jumpTo({
      center: [INTRO_CITY_CENTER.lng, INTRO_CITY_CENTER.lat],
      zoom: INTRO_GLOBE_ZOOM,
      pitch: 0,
      bearing: 0,
    });
    setZoom(INTRO_GLOBE_ZOOM);
    setIntroTitle("in");
    applyBasemapLabels(false);

    let phase: "idle" | "fly1" | "fly2" = "idle";
    const onEnd = () => {
      if (phase === "fly2") finishIntro();
    };
    map.on("moveend", onEnd);

    const fadeTitle = window.setTimeout(() => {
      setIntroTitle("out");
    }, Math.max(500, INTRO_TITLE_HOLD_MS - 250));

    // Step 1 — dive from space into the home sector
    const startFly1 = window.setTimeout(() => {
      phase = "fly1";
      map.flyTo({
        center: [focus.lng, focus.lat],
        zoom: INTRO_MID_ZOOM,
        pitch: PLAY_PITCH,
        bearing: PLAY_BEARING,
        duration: INTRO_FLY1_MS,
        curve: 1.4,
        essential: true,
      });
    }, INTRO_TITLE_HOLD_MS);

    // Step 2 — dive close enough to see villagers
    const startFly2 = window.setTimeout(() => {
      phase = "fly2";
      map.flyTo({
        center: [focus.lng, focus.lat],
        zoom: INTRO_CLOSE_ZOOM,
        pitch: PLAY_PITCH,
        bearing: PLAY_BEARING,
        duration: INTRO_FLY2_MS,
        curve: 1.2,
        essential: true,
      });
    }, INTRO_TITLE_HOLD_MS + INTRO_FLY1_MS + INTRO_MID_HOLD_MS);

    const failsafe = window.setTimeout(
      finishIntro,
      INTRO_TITLE_HOLD_MS +
        INTRO_FLY1_MS +
        INTRO_MID_HOLD_MS +
        INTRO_FLY2_MS +
        900
    );

    return () => {
      window.clearTimeout(fadeTitle);
      window.clearTimeout(startFly1);
      window.clearTimeout(startFly2);
      window.clearTimeout(failsafe);
      map.off("moveend", onEnd);
      // Dep changes / Strict Mode must not leave the map locked
      finishIntro();
    };
  }, [
    mapReady,
    sectors.length,
    me?.homeSectorId,
    homeSector,
    isAzad,
    finishIntro,
    applyBasemapLabels,
  ]);

  // Fly to the player's GPS once when it first appears (not on every watch tick)
  useEffect(() => {
    if (introActive) return;
    if (!userLocation) {
      lastFlownGps.current = null;
      return;
    }
    if (lastFlownGps.current) return;
    lastFlownGps.current = "flown";
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: [userLocation.lng, userLocation.lat],
      zoom: Math.min(
        PLAY_MAX_ZOOM,
        Math.max(map.getZoom(), PLAY_ZOOM)
      ),
      pitch: map.getPitch() || PLAY_PITCH,
      bearing:
        Math.abs(map.getBearing()) > 0.5 ? map.getBearing() : PLAY_BEARING,
      duration: 1200,
      essential: true,
    });
  }, [userLocation, introActive]);

  // Fly to a sector only on explicit picks — never yank the camera after
  // the player has already planted their house/villager in place.
  const lastSectorFocusFlown = useRef(sectorFocus);
  useEffect(() => {
    if (introActive) return;
    if (!selectedId) return;
    const focusBumped = sectorFocus !== lastSectorFocusFlown.current;
    lastSectorFocusFlown.current = sectorFocus;

    // Settled: only fly when the player taps the leaderboard (sectorFocus)
    if (me?.homeSectorId && !focusBumped) return;
    // Unsettled with a pin: stay on the pin, not the sector centroid
    if (!me?.homeSectorId && userLocation) return;

    const sector = sectors.find((s) => s.id === selectedId);
    if (!sector) return;
    const map = mapRef.current;
    if (!map) return;
    const center = ringCentroid(sector.ring);
    map.flyTo({
      center: [center.lng, center.lat],
      zoom: Math.min(
        PLAY_MAX_ZOOM,
        Math.max(map.getZoom(), PLAY_ZOOM)
      ),
      pitch: map.getPitch() || PLAY_PITCH,
      bearing:
        Math.abs(map.getBearing()) > 0.5 ? map.getBearing() : PLAY_BEARING,
      duration: 1100,
      essential: true,
    });
  }, [selectedId, sectorFocus, introActive, me?.homeSectorId, userLocation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-center on GPS when parent bumps userLocationFocus
  useEffect(() => {
    if (introActive) return;
    if (!userLocation || !userLocationFocus) return;
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      center: [userLocation.lng, userLocation.lat],
      zoom: Math.min(
        PLAY_MAX_ZOOM,
        Math.max(map.getZoom(), PLAY_ZOOM)
      ),
      pitch: map.getPitch() || PLAY_PITCH,
      bearing:
        Math.abs(map.getBearing()) > 0.5 ? map.getBearing() : PLAY_BEARING,
      duration: 800,
    });
  }, [userLocationFocus, userLocation, introActive]);

  // Fly back to house / home sector when parent bumps homeFocus
  const lastHomeFocusFlown = useRef(homeFocus);
  useEffect(() => {
    if (introActive) return;
    if (!homeFocus || homeFocus === lastHomeFocusFlown.current) return;
    lastHomeFocusFlown.current = homeFocus;
    const focus = introFocusRef.current;
    if (!focus) return;
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: [focus.lng, focus.lat],
      zoom: Math.min(PLAY_MAX_ZOOM, Math.max(map.getZoom(), PLAY_ZOOM)),
      pitch: map.getPitch() || PLAY_PITCH,
      bearing:
        Math.abs(map.getBearing()) > 0.5 ? map.getBearing() : PLAY_BEARING,
      duration: 1000,
      essential: true,
    });
  }, [homeFocus, introActive]);

  /** Sector economy = total resources farmed by settlers there */
  const sectorEconomy = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sectors) map.set(s.id, 0);
    for (const p of players) {
      if (!p.homeSectorId) continue;
      map.set(p.homeSectorId, (map.get(p.homeSectorId) || 0) + (p.totalFarmed || 0));
    }
    return map;
  }, [sectors, players]);

  /** Highest-economy sector (king of the map) */
  const topSectorId = useMemo(() => {
    let bestId: string | null = null;
    let best = -1;
    for (const s of sectors) {
      const n = sectorEconomy.get(s.id) || 0;
      if (n > best) {
        best = n;
        bestId = s.id;
      }
    }
    return best > 0 ? bestId : null;
  }, [sectors, sectorEconomy]);

  /** Highest totalFarmed settler */
  const topPlayerId = useMemo(() => {
    let bestId: string | null = null;
    let best = -1;
    for (const p of players) {
      if (!p.homeSectorId) continue;
      const n = p.totalFarmed || 0;
      if (n > best) {
        best = n;
        bestId = p.id;
      }
    }
    return best > 0 ? bestId : null;
  }, [players]);

  /**
   * Sectors that have attacked you → red walls.
   * Everyone else stays grey until they raid you.
   */
  const hostileSectorIds = useMemo(() => {
    const hostile = new Set<string>();
    if (!me?.id) return hostile;
    const homeByPlayer = new Map<string, string>();
    for (const p of players) {
      if (p.homeSectorId && !isAzadHomeId(p.homeSectorId)) {
        homeByPlayer.set(p.id, p.homeSectorId);
      }
    }
    if (me.homeSectorId && !isAzadHomeId(me.homeSectorId)) {
      homeByPlayer.set(me.id, me.homeSectorId);
    }
    for (const e of events) {
      if (!isAttackEvent(e)) continue;
      if (e.defenderId !== me.id) continue;
      if (e.attackerId === me.id) continue;
      const attackerHome =
        (e.attackerSectorId && !isAzadHomeId(e.attackerSectorId)
          ? e.attackerSectorId
          : null) ?? homeByPlayer.get(e.attackerId);
      if (
        attackerHome &&
        attackerHome !== me.homeSectorId &&
        !isAzadHomeId(attackerHome)
      ) {
        hostile.add(attackerHome);
      }
    }
    return hostile;
  }, [events, players, me]);

  const fc = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: sectors.map((s) => {
        const farmed = sectorEconomy.get(s.id) || 0;
        const isKing = topSectorId === s.id;
        return {
          type: "Feature" as const,
          id: s.id,
          properties: {
            id: s.id,
            name: s.name,
            mine: me?.homeSectorId === s.id ? 1 : 0,
            hostile: hostileSectorIds.has(s.id) ? 1 : 0,
            economy: farmed,
            king: isKing ? 1 : 0,
            overviewLabel: isKing
              ? `👑 ${s.name}\n${GOLD_COIN} ${formatEconomy(farmed)}`
              : `${s.name}\n${GOLD_COIN} ${formatEconomy(farmed)}`,
          },
          geometry: {
            type: "Polygon" as const,
            coordinates: [s.ring],
          },
        };
      }),
    }),
    [sectors, me, sectorEconomy, topSectorId, hostileSectorIds]
  );

  /** Single perimeter line per sector (no hollow band → no double edges) */
  const wallLineFc = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: sectors.map((s) => ({
        type: "Feature" as const,
        id: `${s.id}-wall`,
        properties: {
          id: s.id,
          name: s.name,
          mine: me?.homeSectorId === s.id ? 1 : 0,
          hostile: hostileSectorIds.has(s.id) ? 1 : 0,
        },
        geometry: {
          type: "LineString" as const,
          coordinates: closeRing(s.ring),
        },
      })),
    }),
    [sectors, me, hostileSectorIds]
  );

  /**
   * Extruded wall band as edge quads (MultiPolygon) — avoids hole spikes
   * on concave sectors like H8.
   */
  const wallBandFc = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: sectors.map((s) => ({
        type: "Feature" as const,
        id: `${s.id}-band`,
        properties: {
          id: s.id,
          mine: me?.homeSectorId === s.id ? 1 : 0,
          hostile: hostileSectorIds.has(s.id) ? 1 : 0,
        },
        geometry: {
          type: "MultiPolygon" as const,
          coordinates: wallBandMultiPolygon(s.ring, SECTOR_WALL_M),
        },
      })),
    }),
    [sectors, me, hostileSectorIds]
  );

  /** Yours = blue; attacked you = red; everyone else = grey */
  const settled = Boolean(me?.homeSectorId);
  const sectorWallColor = [
    "case",
    ["==", ["get", "mine"], 1],
    exploring ? "#7ec8ff" : "#3b9eff",
    ["==", ["get", "hostile"], 1],
    exploring ? "#ff7a6e" : "#ff4d3d",
    ["==", ["get", "id"], selectedId || ""],
    settled
      ? exploring
        ? "#c8cfc6"
        : "#a8b0a4"
      : exploring
        ? "#ffe08a"
        : "#ffd060",
    settled
      ? exploring
        ? "#9aa39a"
        : "#6f776e"
      : exploring
        ? "#9ec8e8"
        : "#d0c4a8",
  ] as never;

  const sectorFillColor = [
    "case",
    ["==", ["get", "mine"], 1],
    "#3b9eff",
    ["==", ["get", "hostile"], 1],
    "#ff4d3d",
    ["==", ["get", "id"], selectedId || ""],
    settled ? "#8a9188" : "#ffd060",
    settled ? "#5c635c" : "#8a8578",
  ] as never;

  const sectorLabelColor = [
    "case",
    ["==", ["get", "mine"], 1],
    "#9fd0ff",
    ["==", ["get", "hostile"], 1],
    "#ffb0a4",
    ["==", ["get", "id"], selectedId || ""],
    settled ? "#e8ebe4" : "#ffe6a0",
    settled ? "#c8cfc6" : "#f0f2ea",
  ] as never;

  // Footprint circles — rel: 0 you, 1 ally, 2 enemy; emphasis while placing
  const footprints = useMemo<FeatureCollection>(() => {
    const feats: Feature<Polygon>[] = [];
    const emphasis = placingMode ? 1 : 0;
    for (const p of detailPlayers) {
      if (!p.homeSectorId) continue;
      const relation = playerRelation(p, me);
      const rel = relation === "self" ? 0 : relation === "ally" ? 1 : 2;
      if (p.house) {
        feats.push(
          circleFeature(p.house, HOUSE_FOOTPRINT_M, {
            rel,
            ghost: 0,
            emphasis,
            preview: 0,
          })
        );
      }
      for (const b of p.buildings) {
        feats.push(
          circleFeature(
            { lat: b.lat, lng: b.lng },
            catalogItem(b.type).footprintM,
            { rel, ghost: 0, emphasis, preview: 0 }
          )
        );
      }
    }
    // Stashed house during first-time settle — keep its claim ring visible
    if (previewHouse) {
      feats.push(
        circleFeature(previewHouse, HOUSE_FOOTPRINT_M, {
          rel: 0,
          ghost: 0,
          emphasis: 1,
          preview: 1,
        })
      );
    }
    if (placing && hover) {
      const fp = placingFootprint(placing.kind);
      const unbound =
        isAzadHomeId(placing.sector.id) || placing.sector.ring.length < 4;
      let inSector = unbound
        ? true
        : pointInRing(hover, placing.sector.ring);
      // Azad: keep placement near GPS pin (settle) or house (build/rebuild)
      if (unbound && inSector) {
        const anchor =
          me?.house ??
          previewHouse ??
          userLocation ??
          (placing.sector.ring[0]
            ? {
                lat: placing.sector.ring[0][1],
                lng: placing.sector.ring[0][0],
              }
            : null);
        if (anchor && distMeters(hover, anchor) > AZAD_PLAY_RADIUS_M) {
          inSector = false;
        }
      }
      let clear = inSector;
      // Villager only needs to stand inside the sector / near pin
      if (clear && placing.kind === "house") {
        clear = !housePlacementError(hover, players, me?.id);
      } else if (clear && placing.kind !== "villager") {
        clear = !buildingPlacementError(hover, fp, players, me?.id);
        if (
          clear &&
          previewHouse &&
          distMeters(hover, previewHouse) < fp + HOUSE_FOOTPRINT_M
        ) {
          clear = false;
        }
      }
      feats.push(
        circleFeature(hover, fp, {
          rel: 0,
          ghost: 1,
          ok: clear ? 1 : 0,
          emphasis: 1,
          preview: 0,
        })
      );
    }
    return { type: "FeatureCollection", features: feats };
  }, [detailPlayers, players, me, placing, hover, userLocation, previewHouse, placingMode]);

  // Seed / clear the drop-ring while placing so villager/house bounds show immediately
  useEffect(() => {
    if (!placing) {
      setHover(null);
      return;
    }
    setHover((cur) => {
      if (cur) return cur;
      if (previewHouse) return previewHouse;
      if (userLocation) return userLocation;
      if (me?.house) return me.house;
      const ring0 = placing.sector.ring[0];
      if (ring0) return { lat: ring0[1], lng: ring0[0] };
      return null;
    });
  }, [placing, previewHouse, userLocation, me?.house]);

  /** Easy/private hiddens in home sector; contested finds visible everywhere */
  const mySpots = useMemo(() => {
    return spots.filter((s) => {
      if (s.claimable) return true;
      if (!me?.homeSectorId) return false;
      return s.sectorId === me.homeSectorId;
    });
  }, [spots, me]);

  /** Walking villagers — one sprite per villager unit (bonus villagers deploy automatically) */
  const villagerMarkers = useMemo(() => {
    const markers: {
      id: string;
      playerId: string;
      name: string;
      relation: ReturnType<typeof playerRelation>;
      unitIndex: number;
      pos: LatLng;
      digging: boolean;
      walking: boolean;
    }[] = [];

    for (const p of detailPlayers) {
      if (!p.homeSectorId || p.villagers <= 0 || (!p.house && !p.villagerPost)) {
        continue;
      }
      const baseOrigin = p.villagerPost ?? p.house!;
      const sector = sectors.find((s) => s.id === p.homeSectorId);
      const easySpots = spots
        .filter((s) => s.sectorId === p.homeSectorId && s.kind === "easy")
        .map((s) => ({ lat: s.lat, lng: s.lng }));

      let offset = 0;
      for (let i = 0; i < p.id.length; i++) offset += p.id.charCodeAt(i);

      const basePhase =
        p.id === me?.id && me
          ? gatherPhase(me, now)
          : ((now + offset * 37) % GATHER_TRIP_MS) / GATHER_TRIP_MS;
      const baseTrip =
        p.id === me?.id && me
          ? gatherTripIndex(me, now)
          : Math.floor((now + offset * 37) / GATHER_TRIP_MS);

      const relation = playerRelation(p, me);
      const count = Math.max(1, Math.floor(p.villagers));

      for (let u = 0; u < count; u++) {
        // Stagger each extra villager so they don't stack on the same path
        const phase = (basePhase + u * 0.31) % 1;
        const tripIndex = baseTrip + u;
        const origin =
          u === 0
            ? baseOrigin
            : offsetMeters(
                baseOrigin,
                Math.cos(u * 2.1) * (10 + u * 6),
                Math.sin(u * 1.7) * (10 + u * 6)
              );
        const target = sector
          ? farmTargetForTrip(
              sector.ring,
              origin,
              easySpots,
              `${p.id}:${tripIndex}:u${u}`
            )
          : easySpots[(tripIndex + u) % Math.max(1, easySpots.length)] ??
            offsetMeters(origin, 36 + u * 8, 18 - u * 5);

        const pose = gatherPose(phase);
        markers.push({
          id: `${p.id}-v${u}`,
          playerId: p.id,
          name: p.name,
          relation,
          unitIndex: u,
          pos: walkPosition(origin, target, phase),
          digging: pose === "dig",
          walking: pose === "walk",
        });
      }
    }
    return markers;
  }, [detailPlayers, spots, sectors, me, now]);

  // Villager working audio — only audible up close (zoom + distance falloff)
  useEffect(() => {
    const map = mapRef.current;
    const diggers = villagerMarkers.filter((v) => v.digging);
    if (!showDetail || !map || diggers.length === 0) {
      stopVillagerWork();
      return;
    }
    const c = map.getCenter();
    const center = { lat: c.lat, lng: c.lng };
    let nearest = Infinity;
    for (const v of diggers) {
      const d = distMeters(center, v.pos);
      if (d < nearest) nearest = d;
    }
    // Audible under ~320m, full volume within 60m — only while digging + zoomed in
    const distFactor = Math.max(0, 1 - Math.max(0, nearest - 60) / 260);
    const zoomFactor = Math.max(0, Math.min(1, (zoom - 14.6) / 1.2));
    setVillagerWorkLevel(distFactor * zoomFactor);
  }, [villagerMarkers, zoom, showDetail]);

  useEffect(() => () => stopVillagerWork(), []);

  // Smooth rAF clock while rockets / impacts are on screen
  useEffect(() => {
    if (!march && !impact) return;
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [march, impact]);

  // Staggered bezier rocket positions for the active salvo
  const flightRockets = useMemo(() => {
    if (!march) return [];
    const n = Math.min(
      MAX_VISIBLE_ROCKETS,
      Math.max(1, march.count ?? 1)
    );
    const stagger = Math.min(160, march.durationMs / (n + 2));
    const out: {
      id: number;
      lat: number;
      lng: number;
      rot: number;
      t: number;
    }[] = [];
    for (let i = 0; i < n; i++) {
      const delay = i * stagger;
      const span = Math.max(400, march.durationMs - delay);
      const raw = (now - march.startedAt - delay) / span;
      if (raw < 0 || raw >= 1) continue;
      const t = easeInOutCubic(raw);
      // Fan lanes: … -1, 0, 1 … around center
      const lane = i - (n - 1) / 2;
      const pos = rocketBezierLatLng(march.from, march.to, t, lane);
      const rot = rocketBezierHeadingDeg(march.from, march.to, t, lane);
      out.push({ id: i, lat: pos.lat, lng: pos.lng, rot, t });
    }
    return out;
  }, [march, now]);

  const trySpawn = useCallback(
    async (
      center: LatLng,
      z: number,
      b: number,
      meters: number,
      explored: number
    ) => {
      if (!onSpawnFind || spawning.current) return;
      if (Date.now() < localCooldownUntil.current) return;
      if (z < EXPLORE_ZOOM) return;
      const azadHome = isAzadHomeId(me?.homeSectorId);
      if (azadHome) {
        if (!me?.house || distMeters(center, me.house) > AZAD_PLAY_RADIUS_M) {
          return;
        }
      } else if (!homeSector || !pointInRing(center, homeSector.ring)) {
        return;
      }
      if (meters < ROAM_METERS_TO_SPAWN) return;
      if (explored < ROAM_MIN_EXPLORE_MS) return;
      spawning.current = true;
      try {
        const ok = await onSpawnFind({
          lat: center.lat,
          lng: center.lng,
          bearing: b,
          zoom: z,
          roamMeters: meters,
          exploreMs: explored,
        });
        if (!ok) {
          localCooldownUntil.current = Date.now() + 4000;
          return;
        }
        setSpawnFlash("A resource appeared — tap to claim!");
        window.setTimeout(() => setSpawnFlash(null), 2800);
        roamAcc.current = 0;
        exploreAcc.current = 0;
        lastExploreTick.current = Date.now();
        localCooldownUntil.current = Date.now() + SPAWN_COOLDOWN_MS;
      } finally {
        spawning.current = false;
      }
    },
    [onSpawnFind, homeSector, me]
  );

  const onMove = useCallback(
    (e: {
      viewState: {
        latitude: number;
        longitude: number;
        zoom: number;
        bearing: number;
      };
    }) => {
      const z = e.viewState.zoom;
      const b = e.viewState.bearing;
      const center = {
        lat: e.viewState.latitude,
        lng: e.viewState.longitude,
      };
      setZoom(z);
      setMapCenter(center);
      onCameraReportRef.current?.(center);
      // Country / city / road names only when fully zoomed into street detail
      applyBasemapLabels(z >= DETAIL_ZOOM);

      const azadHome = isAzadHomeId(me?.homeSectorId);
      const inHome = azadHome
        ? Boolean(me?.house) &&
          distMeters(center, me!.house!) <= AZAD_PLAY_RADIUS_M
        : Boolean(homeSector) && pointInRing(center, homeSector!.ring);
      const deep = z >= EXPLORE_ZOOM && inHome;
      setExploring(deep);

      if (!deep || !me?.homeSectorId) {
        lastCenter.current = null;
        lastExploreTick.current = null;
        return;
      }

      const t = Date.now();
      if (lastExploreTick.current != null) {
        const dt = Math.min(2000, t - lastExploreTick.current);
        if (lastCenter.current) {
          const step = distMeters(lastCenter.current, center);
          if (step > 2.5 && step < 90) {
            exploreAcc.current += dt;
            roamAcc.current += step;
          }
        }
      }
      lastExploreTick.current = t;
      lastCenter.current = center;

      if (
        roamAcc.current >= ROAM_METERS_TO_SPAWN &&
        exploreAcc.current >= ROAM_MIN_EXPLORE_MS
      ) {
        void trySpawn(center, z, b, roamAcc.current, exploreAcc.current);
      }
    },
    [homeSector, me, trySpawn, applyBasemapLabels]
  );

  if (!TOKEN) {
    return (
      <div className={`grid place-items-center bg-[var(--wash)] ${className}`}>
        <p className="font-mono text-xs text-[var(--ink-muted)]">
          No Mapbox token
        </p>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {introTitle !== "gone" && (
        <div
          className={`intro-title ${introTitle === "out" ? "is-fading" : ""}`}
          aria-hidden={introTitle === "out"}
        >
          <p className="intro-title-kicker">Settle · Gather · Raid</p>
          <h1 className="intro-title-name">
            Islamabad
            <span>Territorial Wars</span>
          </h1>
        </div>
      )}
      <MapboxMap
        ref={mapRef}
        mapboxAccessToken={TOKEN}
        initialViewState={{
          longitude: INTRO_CITY_CENTER.lng,
          latitude: INTRO_CITY_CENTER.lat,
          zoom: INTRO_GLOBE_ZOOM,
          pitch: 0,
          bearing: 0,
        }}
        minZoom={introActive ? 0 : PLAY_MIN_ZOOM}
        maxZoom={PLAY_MAX_ZOOM}
        mapStyle="mapbox://styles/mapbox/standard"
        dragPan={!introActive}
        scrollZoom={!introActive}
        doubleClickZoom={!introActive}
        dragRotate={!introActive}
        touchZoomRotate={!introActive}
        keyboard={!introActive}
        onLoad={(e) => {
          // Day/dusk/night from Islamabad clock; Standard ships 3D buildings
          const m = e.target;
          try {
            applyMapLightPreset(m, lightPresetForIslamabad());
            m.setConfigProperty("basemap", "show3dObjects", true);
            m.setConfigProperty("basemap", "showPlaceLabels", false);
            m.setConfigProperty("basemap", "showPointOfInterestLabels", false);
            m.setConfigProperty("basemap", "showRoadLabels", false);
            m.setConfigProperty("basemap", "showTransitLabels", false);
            labelsVisible.current = false;
          } catch {
            /* older style fallback — ignore */
          }
          setMapReady(true);
        }}
        cursor={
          introActive
            ? "default"
            : placing || pinDropActive
              ? "crosshair"
              : "grab"
        }
        onMove={onMove}
        onMouseMove={(e: MapMouseEvent) => {
          if (placing) {
            setHover({ lat: e.lngLat.lat, lng: e.lngLat.lng });
          }
        }}
        onTouchMove={(e) => {
          if (!placing) return;
          const ll = e.lngLat;
          if (!ll) return;
          setHover({ lat: ll.lat, lng: ll.lng });
        }}
        onClick={(e: MapMouseEvent) => {
          if (placing) {
            const pos = { lat: e.lngLat.lat, lng: e.lngLat.lng };
            setHover(pos);
            // Block occupied drops here so a stale PlayShell closure can't accept them
            if (placing.kind === "house") {
              const blocked = housePlacementError(
                pos,
                playersRef.current,
                meRef.current?.id
              );
              if (blocked) {
                onPlaceBlockedRef.current?.(blocked);
                return;
              }
            } else if (placing.kind !== "villager") {
              const fp = placingFootprint(placing.kind);
              const blocked = buildingPlacementError(
                pos,
                fp,
                playersRef.current,
                meRef.current?.id
              );
              if (blocked) {
                onPlaceBlockedRef.current?.(blocked);
                return;
              }
            }
            onPlaceRef.current?.(pos.lat, pos.lng);
            return;
          }
          if (pinDropActive && onDropPin) {
            onDropPin(e.lngLat.lat, e.lngLat.lng);
            return;
          }

          // Prefer POI / place labels over sector-fill so shops stay tappable
          // under our top-slot washes. Pad the hit box for fat-finger taps.
          const at = { lat: e.lngLat.lat, lng: e.lngLat.lng };
          const pad = 18;
          const hitBox: [[number, number], [number, number]] = [
            [e.point.x - pad, e.point.y - pad],
            [e.point.x + pad, e.point.y + pad],
          ];
          type QueryMap = {
            queryRenderedFeatures: (
              geometry?:
                | { x: number; y: number }
                | [[number, number], [number, number]],
              opts?: {
                target?: { featuresetId: string; importId: string };
                layers?: string[];
              }
            ) => unknown[];
          };
          const qmap = e.target as unknown as QueryMap;

          if (onSelectBusiness && me?.homeSectorId && showDetail) {
            let featuresetHits: unknown[] = [];
            try {
              featuresetHits = qmap.queryRenderedFeatures(hitBox, {
                target: { featuresetId: "poi", importId: "basemap" },
              });
            } catch {
              featuresetHits = [];
            }
            let rendered: unknown[] = [];
            try {
              rendered = qmap.queryRenderedFeatures(hitBox) as unknown[];
            } catch {
              rendered = [];
            }
            const biz = resolveTappedPlaceLabel(at, rendered, featuresetHits);
            if (biz && trySelectBusiness(biz)) return;
          }

          // Sector pick via geometry (fill layer is non-interactive so POIs win)
          const sectorHit = sectors.find((s) => pointInRing(at, s.ring));
          if (sectorHit) onSelect(sectorHit.id);
        }}
        style={{ width: "100%", height: "100%" }}
      >
        {/* Sector hit target + soft ownership wash (walls stay the main signal) */}
        <Source id="sectors" type="geojson" data={fc}>
          <Layer
            id="sector-fill"
            type="fill"
            slot="bottom"
            paint={{
              "fill-color": sectorFillColor,
              "fill-opacity": [
                "case",
                ["==", ["get", "mine"], 1],
                exploring ? 0.12 : 0.2,
                ["==", ["get", "id"], selectedId || ""],
                exploring ? 0.1 : 0.16,
                settled ? (exploring ? 0.08 : 0.12) : 0.03,
              ] as never,
            }}
          />
          {/* Overview only: sector name + economy (hidden once settlement detail shows) */}
          <Layer
            id="sector-label"
            type="symbol"
            slot="top"
            maxzoom={DETAIL_ZOOM}
            layout={{
              "text-field": ["get", "overviewLabel"],
              "text-size": 13,
              "text-line-height": 1.15,
              "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            }}
            paint={{
              "text-color": sectorLabelColor,
              "text-halo-color": "#0c100e",
              "text-halo-width": 1.4,
              "text-opacity": 1,
            }}
          />
        </Source>

        {/* Solid wall band — middle slot so Standard keeps 3D extrusion */}
        <Source id="sector-wall-bands" type="geojson" data={wallBandFc}>
          <Layer
            id="sector-wall-solid"
            type="fill-extrusion"
            slot="middle"
            paint={{
              "fill-extrusion-color": sectorWallColor,
              "fill-extrusion-base": 0,
              "fill-extrusion-height": [
                "case",
                ["==", ["get", "mine"], 1],
                SECTOR_WALL_HEIGHT_MINE_M,
                SECTOR_WALL_HEIGHT_M,
              ] as never,
              "fill-extrusion-opacity": SECTOR_WALL_OPACITY,
              "fill-extrusion-vertical-gradient": false,
            }}
          />
        </Source>

        {/* Single perimeter glow + crisp stroke */}
        <Source id="sector-walls" type="geojson" data={wallLineFc}>
          <Layer
            id="sector-wall-glow-outer"
            type="line"
            slot="top"
            layout={{
              "line-join": "round",
              "line-cap": "round",
            }}
            paint={{
              "line-color": sectorWallColor,
              "line-width": [
                "case",
                ["==", ["get", "mine"], 1],
                16,
                12,
              ] as never,
              "line-blur": 8,
              "line-opacity": [
                "case",
                ["==", ["get", "mine"], 1],
                exploring ? 0.35 : 0.55,
                exploring ? 0.25 : 0.4,
              ] as never,
            }}
          />
          <Layer
            id="sector-wall-glow"
            type="line"
            slot="top"
            layout={{
              "line-join": "round",
              "line-cap": "round",
            }}
            paint={{
              "line-color": sectorWallColor,
              "line-width": [
                "case",
                ["==", ["get", "mine"], 1],
                8,
                6,
              ] as never,
              "line-blur": 3,
              "line-opacity": [
                "case",
                ["==", ["get", "mine"], 1],
                exploring ? 0.55 : 0.8,
                exploring ? 0.4 : 0.65,
              ] as never,
            }}
          />
          <Layer
            id="sector-wall-base"
            type="line"
            slot="top"
            layout={{
              "line-join": "round",
              "line-cap": "round",
            }}
            paint={{
              "line-color": sectorWallColor,
              "line-width": [
                "case",
                ["==", ["get", "mine"], 1],
                exploring ? 2.5 : 3.5,
                exploring ? 2 : 2.8,
              ] as never,
              "line-opacity": 0.98,
            }}
          />
        </Source>

        {/* Overview: dots only — names/economy live on sector labels */}
        {!showDetail &&
          players
            .filter((p) => p.homeSectorId)
            .map((p) => {
              const at = playerAnchor(p);
              if (!at) return null;
              const relation = playerRelation(p, me);
              const canTarget = relation === "enemy";
              const isKing = topPlayerId === p.id;
              return (
                <Marker
                  key={`pin-${p.id}`}
                  longitude={at.lng}
                  latitude={at.lat}
                  anchor="center"
                >
                  <button
                    type="button"
                    className={`player-pin player-pin-dot-only is-${relation} ${
                      isKing ? "is-king" : ""
                    } ${selectedPlayerId === p.id ? "is-selected" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canTarget) onSelectPlayer?.(p.id);
                      else onSelectPlayer?.(null);
                    }}
                    title={
                      isKing
                        ? relation === "self"
                          ? "You — top settler"
                          : `${p.name} — top settler`
                        : relation === "self"
                          ? "You"
                          : relation === "ally"
                            ? `${p.name} (ally — same sector)`
                            : `Tap to target ${p.name}`
                    }
                    aria-label={
                      isKing
                        ? relation === "self"
                          ? "You, top settler"
                          : `${p.name}, top settler`
                        : relation === "self"
                          ? "You"
                          : p.name
                    }
                  >
                    {isKing && (
                      <span className="player-pin-crown" aria-hidden>
                        👑
                      </span>
                    )}
                    {(relation === "self" || isKing) && (
                      <span className="player-pin-name">
                        {relation === "self" ? "You" : p.name}
                      </span>
                    )}
                    <span className="player-pin-dot" />
                  </button>
                </Marker>
              );
            })}

        {/* Detail / placement: footprints, houses, buildings, villagers, resources */}
        {showPlaceOverlays && (
          <>
            <Source id="footprints" type="geojson" data={footprints}>
              <Layer
                id="footprint-fill"
                type="fill"
                slot="top"
                paint={{
                  "fill-color": [
                    "case",
                    ["==", ["get", "ghost"], 1],
                    ["case", ["==", ["get", "ok"], 1], "#3ddb7a", "#e23b2f"],
                    ["==", ["get", "preview"], 1],
                    "#e8cf8a",
                    ["==", ["get", "rel"], 0],
                    "#3b9eff",
                    ["==", ["get", "rel"], 1],
                    "#3ddb7a",
                    "#e23b2f",
                  ] as never,
                  "fill-opacity": [
                    "case",
                    ["==", ["get", "ghost"], 1],
                    0.34,
                    ["==", ["get", "preview"], 1],
                    0.32,
                    ["==", ["get", "emphasis"], 1],
                    0.26,
                    0.1,
                  ] as never,
                }}
              />
              <Layer
                id="footprint-line"
                type="line"
                slot="top"
                paint={{
                  "line-color": [
                    "case",
                    ["==", ["get", "ghost"], 1],
                    ["case", ["==", ["get", "ok"], 1], "#7dffb0", "#ff5245"],
                    ["==", ["get", "preview"], 1],
                    "#f0e0a0",
                    ["==", ["get", "rel"], 0],
                    "#7ec8ff",
                    ["==", ["get", "rel"], 1],
                    "#4dff8a",
                    "#ff6b5c",
                  ] as never,
                  "line-width": [
                    "case",
                    ["==", ["get", "ghost"], 1],
                    3,
                    ["==", ["get", "emphasis"], 1],
                    2.75,
                    1,
                  ] as never,
                  "line-opacity": [
                    "case",
                    ["==", ["get", "emphasis"], 1],
                    0.95,
                    0.75,
                  ] as never,
                }}
              />
              <Layer
                id="footprint-line-dash"
                type="line"
                slot="top"
                filter={["==", ["get", "ghost"], 1]}
                paint={{
                  "line-color": [
                    "case",
                    ["==", ["get", "ok"], 1],
                    "#c8ffe0",
                    "#ffb0a8",
                  ] as never,
                  "line-width": 1.25,
                  "line-dasharray": [1.2, 1.6] as never,
                  "line-opacity": 0.9,
                }}
              />
            </Source>

            {detailPlayers
              .filter((p) => p.homeSectorId && p.house)
              .map((p) => {
                const isKing = topPlayerId === p.id;
                const relation = playerRelation(p, me);
                const ownerLabel =
                  relation === "self" ? "You" : p.name;
                const houseSub =
                  relation === "self"
                    ? "Your house"
                    : relation === "ally"
                      ? "Ally house"
                      : "Enemy house";
                return (
                  <Marker
                    key={`house-${p.id}`}
                    longitude={p.house!.lng}
                    latitude={p.house!.lat}
                    anchor="bottom"
                  >
                    <button
                      type="button"
                      className={`house-marker house-marker--${relation} relative flex flex-col items-center bg-transparent p-0 ${
                        selectedPlayerId === p.id ? "is-selected" : ""
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        // While placing a house/building, tapping a structure is occupied ground
                        if (placing && placing.kind !== "villager") {
                          onPlaceBlockedRef.current?.(
                            placing.kind === "house"
                              ? "Too close to another house"
                              : "That ground is occupied — pick a clear spot"
                          );
                          return;
                        }
                        if (
                          p.id !== me?.id &&
                          p.homeSectorId &&
                          me?.homeSectorId &&
                          p.homeSectorId !== me.homeSectorId
                        ) {
                          onSelectPlayer?.(p.id);
                        } else {
                          onSelectPlayer?.(null);
                        }
                      }}
                      title={
                        placing && placing.kind !== "villager"
                          ? "Occupied — pick a clear spot"
                          : isKing
                            ? `${ownerLabel} — top settler`
                            : houseSub
                      }
                    >
                      <span
                        className={`map-unit-tag map-unit-tag-house map-unit-tag-house--${relation}`}
                      >
                        <span className="map-unit-tag-name">
                          {isKing ? "👑 " : ""}
                          {ownerLabel}
                        </span>
                        <span className="map-unit-tag-sub">{houseSub}</span>
                      </span>
                      <span className="house-marker-pad" aria-hidden>
                        <HouseSprite className="house-marker-sprite drop-shadow-md" />
                      </span>
                      <HpBar
                        hp={p.houseHp ?? HOUSE_MAX_HP}
                        maxHp={HOUSE_MAX_HP}
                        width={48}
                      />
                    </button>
                  </Marker>
                );
              })}

            {detailPlayers
              .filter((p) => p.homeSectorId)
              .flatMap((p) =>
                p.buildings.map((b) => {
                  const maxHp = catalogItem(b.type).hp;
                  const relation = playerRelation(p, me);
                  const canRaid =
                    relation === "enemy" &&
                    p.id !== me?.id &&
                    Boolean(p.homeSectorId) &&
                    Boolean(me?.homeSectorId);
                  const canRaze =
                    relation === "ally" &&
                    p.id !== me?.id &&
                    Boolean(me?.homeSectorId);
                  const razeSelected = selectedRazeBuildingId === b.id;
                  const syncing = syncingSet.has(b.id);
                  const bName = catalogItem(b.type).name;
                  return (
                    <Marker
                      key={b.id}
                      longitude={b.lng}
                      latitude={b.lat}
                      anchor="bottom"
                    >
                      <button
                        type="button"
                        className={`relative flex flex-col items-center bg-transparent p-0 ${
                          relation === "ally" ? "ally-structure" : ""
                        } ${
                          selectedPlayerId === p.id || razeSelected
                            ? "ring-2 ring-[var(--sand)] rounded-sm"
                            : ""
                        } ${syncing ? "building-syncing" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (placing && placing.kind !== "villager") {
                            onPlaceBlockedRef.current?.(
                              "That ground is occupied — pick a clear spot"
                            );
                            return;
                          }
                          if (syncing) return;
                          if (p.id === me?.id) {
                            onSelectPlayer?.(null);
                            onSelectRaze?.(null);
                            if (b.type === "shovel" && onSelectShovel) {
                              onSelectShovel(b.id);
                            }
                            onSelectOwnBuilding?.(b.id);
                            return;
                          }
                          if (canRaid) {
                            onSelectRaze?.(null);
                            onSelectPlayer?.(p.id);
                          } else if (canRaze) {
                            onSelectPlayer?.(null);
                            onSelectRaze?.({
                              playerId: p.id,
                              buildingId: b.id,
                            });
                          } else {
                            onSelectPlayer?.(null);
                            onSelectRaze?.(null);
                          }
                        }}
                        title={
                          placing && placing.kind !== "villager"
                            ? "Occupied — pick a clear spot"
                            : syncing
                              ? `Syncing ${bName}…`
                              : p.id === me?.id && b.type === "shovel"
                                ? "Tap to dig — upgrade or delete from the panel"
                                : p.id === me?.id
                                  ? `Your ${bName} — tap to upgrade or delete`
                                  : canRaid
                                    ? `Tap to raid ${p.name}`
                                    : canRaze
                                      ? `Rocket ${p.name}'s ${bName} to free ground`
                                      : `${p.name}'s ${bName}`
                        }
                      >
                        {relation === "ally" && !syncing && (
                          <span className="map-unit-tag map-unit-tag-ally">
                            <span className="map-unit-tag-name">{p.name}</span>
                            <span className="map-unit-tag-sub">
                              Ally · {bName}
                            </span>
                          </span>
                        )}
                        {syncing && (
                          <span
                            className="building-sync-loader"
                            aria-label="Syncing with server"
                          />
                        )}
                        <BuildingSprite type={b.type} />
                        {(b.level ?? 1) >= 2 && !syncing && (
                          <span
                            className="absolute -right-1 -top-1 rounded-sm bg-[#e8cf8a] px-0.5 font-mono text-[8px] font-bold leading-tight text-black"
                            title="Upgraded · ×2 output"
                          >
                            ×2
                          </span>
                        )}
                        <HpBar hp={b.hp ?? maxHp} maxHp={maxHp} width={38} />
                        {p.id === me?.id &&
                          b.type === "shovel" &&
                          !syncing && (
                            <span className="map-unit-tag map-unit-tag-dig">
                              Dig
                            </span>
                          )}
                        {relation === "enemy" && !syncing && (
                          <span className="map-unit-dot map-unit-dot-enemy" />
                        )}
                        {relation === "ally" && !syncing && (
                          <span
                            className={`map-unit-dot ${
                              canRaze
                                ? "map-unit-dot-clear"
                                : "map-unit-dot-ally"
                            }`}
                          />
                        )}
                      </button>
                    </Marker>
                  );
                })
              )}

            {detailPlayers
              .filter((p) => p.homeSectorId && p.house && (p.rockets || 0) > 0)
              .map((p) => {
                const pos = offsetMeters(p.house!, 26, -12);
                return (
                  <Marker
                    key={`rockets-${p.id}`}
                    longitude={pos.lng}
                    latitude={pos.lat}
                    anchor="bottom"
                  >
                    <div className="relative flex flex-col items-center">
                      <RocketSprite className="h-8 w-8" />
                      <HpBar
                        hp={p.rockets}
                        maxHp={Math.max(p.peakRockets || 0, p.rockets)}
                        width={30}
                      />
                      <span className="absolute -right-1.5 -top-1 rounded-full bg-[var(--surface)] px-1 font-mono text-[9px] text-[#ff9d5a]">
                        ×{p.rockets}
                      </span>
                    </div>
                  </Marker>
                );
              })}

            {mySpots
              .filter((s) => s.kind === "easy")
              .map((s) => (
                <Marker
                  key={s.id}
                  longitude={s.lng}
                  latitude={s.lat}
                  anchor="bottom"
                >
                  <ResourceNode gem={s.gem || "wood"} size={30} pulse />
                </Marker>
              ))}

            {mySpots
              .filter((s) => s.kind === "hidden")
              .map((s) => {
                const ready = s.availableAt <= now;
                const gem = s.gem || "diamond";
                const contested = Boolean(s.claimable);
                const mine = s.ownerId === me?.id;
                const claiming = claimingSet.has(s.id);
                return (
                  <Marker
                    key={s.id}
                    longitude={s.lng}
                    latitude={s.lat}
                    anchor="center"
                  >
                    <div
                      className={`relative ${claiming ? "gem-claiming" : ""}`}
                    >
                      {claiming && (
                        <span
                          className="building-sync-loader"
                          aria-label="Claiming…"
                        />
                      )}
                      <ResourceNode
                        gem={gem}
                        size={ready || contested ? 40 : 32}
                        depleted={claiming || (!ready && !contested)}
                        pulse={!claiming && (ready || contested)}
                        title={
                          claiming
                            ? "Claiming…"
                            : contested
                              ? mine
                                ? `${GEM_META[gem].label} — tap to claim (others can snatch it)`
                                : `${GEM_META[gem].label} — tap to claim`
                              : ready
                                ? `${GEM_META[gem].label} — tap to collect`
                                : `${GEM_META[gem].label} refilling…`
                        }
                        onClick={() => {
                          if (claiming) return;
                          if (contested || ready) onCollectHidden?.(s.id);
                        }}
                      />
                    </div>
                  </Marker>
                );
              })}

            {villagerMarkers.map((v) => (
              <Marker
                key={`villager-${v.id}`}
                longitude={v.pos.lng}
                latitude={v.pos.lat}
                anchor="bottom"
              >
                <div
                  className={`relative ${
                    v.relation === "enemy" ? "rival-villager" : ""
                  }`}
                  title={
                    v.digging
                      ? v.relation === "self"
                        ? "Villager farming"
                        : `${v.name}'s villager farming`
                      : v.relation === "self"
                        ? "Villager"
                        : `${v.name}'s villager`
                  }
                >
                  {v.unitIndex === 0 && (
                    <span
                      className={`absolute -top-3.5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-sm px-1 font-mono text-[8px] ${
                        v.relation === "self"
                          ? "bg-[rgba(10,14,18,0.85)] text-[#7ec8ff]"
                          : v.relation === "ally"
                            ? "bg-[rgba(10,14,10,0.85)] text-[var(--field-bright)] ring-1 ring-[var(--field)]"
                            : "bg-[rgba(10,14,10,0.9)] text-[var(--signal-bright)] ring-1 ring-[var(--signal)]"
                      }`}
                    >
                      {topPlayerId === v.playerId ? "👑 " : ""}
                      Villager
                    </span>
                  )}
                  <VillagerSprite
                    walking={v.walking}
                    digging={v.digging}
                    className="h-10 w-10 drop-shadow-md"
                  />
                  {v.digging && <span className="villager-dirt" aria-hidden />}
                </div>
              </Marker>
            ))}
          </>
        )}

        {/* Pending house during claim flow — always visible */}
        {previewHouse && (
          <Marker
            longitude={previewHouse.lng}
            latitude={previewHouse.lat}
            anchor="bottom"
          >
            <HouseSprite className="h-10 w-11 opacity-70" />
          </Marker>
        )}

        {/* Exact GPS / manual pin while selecting / claiming a sector */}
        {userLocation && (
          <Marker
            longitude={userLocation.lng}
            latitude={userLocation.lat}
            anchor="center"
            draggable={pinDraggable}
            onDragEnd={(e) => {
              if (!onMovePin) return;
              const ll = e.lngLat;
              if (!ll) return;
              onMovePin(ll.lat, ll.lng);
            }}
          >
            <div
              className="you-are-here"
              title={pinDraggable ? "Drag to move your pin" : "Your location"}
            >
              <span className="you-are-here-pulse" />
              <span className="you-are-here-dot" />
              <span className="you-are-here-label">
                {pinDraggable ? "Drag" : "You"}
              </span>
            </div>
          </Marker>
        )}

        {/* Rocket salvo — bezier arcs toward target */}
        {flightRockets.map((r) => (
          <Marker
            key={`rocket-${r.id}`}
            longitude={r.lng}
            latitude={r.lat}
            anchor="center"
          >
            <div
              className="rocket-flight"
              style={
                {
                  "--rocket-rot": `${r.rot}deg`,
                } as CSSProperties
              }
            >
              <span className="rocket-flight-trail" aria-hidden />
              <RocketSprite className="h-9 w-9 rocket-flight-sprite" />
            </div>
          </Marker>
        ))}

        {/* Attack impact explosion */}
        {impact && now - impact.startedAt < IMPACT_DURATION_MS && (
          <Marker
            longitude={impact.at.lng}
            latitude={impact.at.lat}
            anchor="center"
          >
            <div className="impact-burst" aria-hidden>
              <span className="impact-ring" />
              <span className="impact-ring impact-ring-2" />
              <span className="impact-core" />
              <span className="impact-spark impact-spark-a" />
              <span className="impact-spark impact-spark-b" />
              <span className="impact-spark impact-spark-c" />
              <span className="impact-spark impact-spark-d" />
            </div>
          </Marker>
        )}

        <ViewerMarkers
          peers={presencePeers}
          self={presenceSelf}
          center={mapCenter}
          maxDistanceM={
            showDetail ? DETAIL_VIEWER_RADIUS_M : OVERVIEW_VIEWER_RADIUS_M
          }
        />

        {/* Guided placement beacon — must stay inside MapboxMap */}
        {guidePulse && placing && (
          <Marker
            latitude={
              placing.sector.ring.length >= 4
                ? ringCentroid(placing.sector.ring).lat
                : hover?.lat ??
                  userLocation?.lat ??
                  me?.house?.lat ??
                  33.71
            }
            longitude={
              placing.sector.ring.length >= 4
                ? ringCentroid(placing.sector.ring).lng
                : hover?.lng ??
                  userLocation?.lng ??
                  me?.house?.lng ??
                  73.045
            }
            anchor="center"
          >
            <div className="guide-map-beacon" aria-hidden />
          </Marker>
        )}
      </MapboxMap>

      {/* Placement banner */}
      {placing && (
        <div
          data-guide="guide-place-banner"
          className="pointer-events-none absolute left-1/2 top-14 z-10 -translate-x-1/2"
        >
          <p className="hud-chip px-4 py-2 text-center text-xs font-semibold text-[var(--sand)]">
            {isAzadHomeId(placing.sector.id) ||
            placing.sector.ring.length < 4
              ? `Tap near your pin to place your ${placingLabel(placing.kind)} — no sector walls in ${AZAD_ARENA_NAME}`
              : `Tap inside ${placing.sector.name} to place your ${placingLabel(placing.kind)} — bright rings show taken ground · green = clear`}
          </p>
        </div>
      )}

      {me?.homeSectorId && !placing && spawnFlash && (
        <div className="pointer-events-none absolute bottom-[7.75rem] left-1/2 z-10 w-[min(16.5rem,calc(100%-7rem))] -translate-x-1/2 sm:bottom-[8.75rem] sm:w-[min(18rem,calc(100%-20rem))]">
          <p className="hud-chip px-2.5 py-1.5 text-center text-[11px] font-semibold text-[var(--field-bright)] sm:px-3 sm:text-xs">
            {spawnFlash}
          </p>
        </div>
      )}

      {me?.homeSectorId && showDetail && !placing && !spawnFlash && (
        <div className="pointer-events-none absolute bottom-[7.75rem] left-1/2 z-10 w-[min(17rem,calc(100%-7rem))] -translate-x-1/2 sm:bottom-[8.75rem] sm:w-[min(19rem,calc(100%-20rem))]">
          <p className="hud-chip px-2.5 py-1.5 text-center text-[10px] font-semibold text-[var(--sand)] sm:px-3 sm:text-[11px]">
            Tap a local business — leave a review, earn a villager!
          </p>
        </div>
      )}
    </div>
  );
}
