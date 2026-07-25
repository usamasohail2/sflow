"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapboxMap, { Layer, Marker, Source } from "react-map-gl/mapbox";
import type { MapMouseEvent, MapRef } from "react-map-gl/mapbox";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import type {
  Building,
  BuildingType,
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
  INTRO_FLY_MS,
  INTRO_GLOBE_ZOOM,
  INTRO_TITLE_HOLD_MS,
  PLAY_BEARING,
  PLAY_MAX_ZOOM,
  PLAY_MIN_ZOOM,
  PLAY_PITCH,
  PLAY_ZOOM,
  ROAM_METERS_TO_SPAWN,
  ROAM_MIN_EXPLORE_MS,
  SPAWN_COOLDOWN_MS,
  catalogItem,
} from "@/lib/gameTypes";
import { closeRing, pointInRing, wallBandCoordinates } from "@/lib/geo";

/** Thin extruded wall band — lines stay on the single perimeter */
const SECTOR_WALL_M = 16;
/** Stacked extrusions — taller boundary walls fading upward */
const SECTOR_WALL_STACK = [
  { id: "sector-wall-low", base: 0, height: 56, opacity: 0.88 },
  { id: "sector-wall-mid", base: 56, height: 120, opacity: 0.48 },
  { id: "sector-wall-high", base: 120, height: 200, opacity: 0.18 },
] as const;

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
  farmTargetForTrip,
  lerpLatLng,
  offsetMeters,
  ringCentroid,
} from "@/lib/mapMath";
import { setVillagerWorkLevel, stopVillagerWork } from "@/lib/sound";
import {
  GATHER_DIG_END,
  GATHER_WALK_OUT_END,
  gatherPhase,
  gatherTripIndex,
} from "@/lib/rules";
import {
  HouseSprite,
  MillSprite,
  RocketSprite,
  TurretSprite,
  VillagerSprite,
  WarehouseSprite,
  WellSprite,
} from "@/components/sprites";
import { ResourceNode } from "@/components/ResourceNode";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

export type MarchAnim = {
  from: LatLng;
  to: LatLng;
  startedAt: number;
  durationMs: number;
};

export type ImpactAnim = {
  at: LatLng;
  startedAt: number;
};

const IMPACT_DURATION_MS = 1400;

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

const VILLAGER_FOOTPRINT_M = 8;

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
  march: MarchAnim | null;
  impact: ImpactAnim | null;
  onSelect: (id: string) => void;
  /** Tap another settler's house to target them (null clears) */
  onSelectPlayer?: (playerId: string | null) => void;
  selectedPlayerId?: string | null;
  onPlace?: (lat: number, lng: number) => void;
  onSpawnFind?: (payload: {
    lat: number;
    lng: number;
    bearing: number;
    zoom: number;
    roamMeters: number;
    exploreMs: number;
  }) => boolean | Promise<boolean>;
  onCollectHidden?: (spotId: string) => void;
  /** Fires once when the globe → sector intro finishes */
  onIntroComplete?: () => void;
  /** Pulsing map beacon during guided house/villager placement */
  guidePulse?: boolean;
  className?: string;
};

function BuildingSprite({ type }: { type: Building["type"] }) {
  if (type === "mill") return <MillSprite className="h-9 w-10 drop-shadow-md" />;
  if (type === "warehouse")
    return <WarehouseSprite className="h-9 w-10 drop-shadow-md" />;
  if (type === "turret")
    return <TurretSprite className="h-9 w-10 drop-shadow-md" />;
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
  for (let i = 0; i <= 20; i++) {
    const a = (i / 20) * Math.PI * 2;
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
  march,
  impact,
  onSelect,
  onSelectPlayer,
  selectedPlayerId = null,
  onPlace,
  onSpawnFind,
  onCollectHidden,
  onIntroComplete,
  guidePulse = false,
  className = "",
}: Props) {
  const onIntroCompleteRef = useRef(onIntroComplete);
  onIntroCompleteRef.current = onIntroComplete;
  const mapRef = useRef<MapRef>(null);
  const [zoom, setZoom] = useState(INTRO_GLOBE_ZOOM);
  const showDetail = zoom >= DETAIL_ZOOM;
  const [now, setNow] = useState(() => Date.now());
  const [roamMeters, setRoamMeters] = useState(0);
  const [exploreMs, setExploreMs] = useState(0);
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

  const homeSector = useMemo(
    () => sectors.find((s) => s.id === me?.homeSectorId) ?? null,
    [sectors, me]
  );

  const introFocus = useMemo((): LatLng => {
    if (homeSector) return ringCentroid(homeSector.ring);
    if (me?.house) return me.house;
    if (sectors[0]) return ringCentroid(sectors[0].ring);
    return { lat: 33.71, lng: 73.045 };
  }, [homeSector, me?.house, sectors]);
  const introFocusRef = useRef(introFocus);
  introFocusRef.current = introFocus;

  const applyBasemapLabels = useCallback((show: boolean) => {
    if (labelsVisible.current === show) return;
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
      // If intro aborted early (e.g. Strict Mode), snap to the play camera
      if (
        z < PLAY_MIN_ZOOM ||
        pitch < PLAY_PITCH * 0.5 ||
        Math.abs(bearing - PLAY_BEARING) > 40
      ) {
        const { lat, lng } = introFocusRef.current;
        map.easeTo({
          center: [lng, lat],
          zoom: Math.max(z, PLAY_MIN_ZOOM),
          pitch: PLAY_PITCH,
          bearing: PLAY_BEARING,
          duration: 280,
        });
      }
    }
    onIntroCompleteRef.current?.();
  }, []);

  // Globe → home sector intro on first load
  useEffect(() => {
    if (!mapReady || introStarted.current || introFinished.current) return;
    if (sectors.length === 0) return;
    // Wait for home geometry when the player is already settled
    if (me?.homeSectorId && !homeSector) return;

    introStarted.current = true;
    const map = mapRef.current;
    if (!map) return;

    const { lat, lng } = introFocusRef.current;
    map.jumpTo({
      center: [lng, lat],
      zoom: INTRO_GLOBE_ZOOM,
      pitch: 0,
      bearing: 0,
    });
    setZoom(INTRO_GLOBE_ZOOM);
    setIntroTitle("in");
    applyBasemapLabels(false);

    let flying = false;
    const onEnd = () => {
      if (!flying) return;
      finishIntro();
    };
    map.on("moveend", onEnd);

    // Hold on the globe with the title, then fade title and fly in
    const fadeTitle = window.setTimeout(() => {
      setIntroTitle("out");
    }, Math.max(400, INTRO_TITLE_HOLD_MS - 200));

    const startFly = window.setTimeout(() => {
      flying = true;
      map.flyTo({
        center: [lng, lat],
        zoom: PLAY_ZOOM,
        pitch: PLAY_PITCH,
        bearing: PLAY_BEARING,
        duration: INTRO_FLY_MS,
        curve: 1.35,
        essential: true,
      });
    }, INTRO_TITLE_HOLD_MS);

    // Always unlock even if moveend is missed or this effect is cleaned up
    const failsafe = window.setTimeout(
      finishIntro,
      INTRO_TITLE_HOLD_MS + INTRO_FLY_MS + 800
    );

    return () => {
      window.clearTimeout(fadeTitle);
      window.clearTimeout(startFly);
      window.clearTimeout(failsafe);
      map.off("moveend", onEnd);
      // Dep changes / Strict Mode must not leave the map locked
      finishIntro();
    };
  }, [
    mapReady,
    sectors.length,
    me?.homeSectorId,
    homeSector?.id,
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

  // Re-center when picking a sector, or when parent requests focus (GPS confirm)
  useEffect(() => {
    if (introActive) return;
    if (!userLocation) return;
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
  }, [selectedId, userLocationFocus, introActive]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const fc = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: sectors.map((s) => {
        const farmed = sectorEconomy.get(s.id) || 0;
        return {
          type: "Feature" as const,
          id: s.id,
          properties: {
            id: s.id,
            name: s.name,
            mine: me?.homeSectorId === s.id ? 1 : 0,
            economy: farmed,
            overviewLabel: `${s.name}\n${formatEconomy(farmed)}g`,
          },
          geometry: {
            type: "Polygon" as const,
            coordinates: [s.ring],
          },
        };
      }),
    }),
    [sectors, me, sectorEconomy]
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
        },
        geometry: {
          type: "LineString" as const,
          coordinates: closeRing(s.ring),
        },
      })),
    }),
    [sectors, me]
  );

  /** Extruded wall band only (no line stroke on this source) */
  const wallBandFc = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: sectors.map((s) => ({
        type: "Feature" as const,
        id: `${s.id}-band`,
        properties: {
          id: s.id,
          mine: me?.homeSectorId === s.id ? 1 : 0,
        },
        geometry: {
          type: "Polygon" as const,
          coordinates: wallBandCoordinates(s.ring, SECTOR_WALL_M),
        },
      })),
    }),
    [sectors, me]
  );

  /** Your sector = blue; enemy sectors = red; pre-settle select = gold */
  const settled = Boolean(me?.homeSectorId);
  const sectorWallColor = [
    "case",
    ["==", ["get", "mine"], 1],
    exploring ? "#7ec8ff" : "#3b9eff",
    ["==", ["get", "id"], selectedId || ""],
    settled
      ? exploring
        ? "#ff9a7a"
        : "#ff5e4d"
      : exploring
        ? "#ffe08a"
        : "#ffd060",
    settled
      ? exploring
        ? "#ff7a6e"
        : "#ff4d3d"
      : exploring
        ? "#9ec8e8"
        : "#d0c4a8",
  ] as never;

  const sectorFillColor = [
    "case",
    ["==", ["get", "mine"], 1],
    "#3b9eff",
    ["==", ["get", "id"], selectedId || ""],
    settled ? "#ff5a45" : "#ffd060",
    settled ? "#ff4d3d" : "#8a8578",
  ] as never;

  const sectorLabelColor = [
    "case",
    ["==", ["get", "mine"], 1],
    "#9fd0ff",
    ["==", ["get", "id"], selectedId || ""],
    settled ? "#ffc4b8" : "#ffe6a0",
    settled ? "#ffb0a4" : "#f0f2ea",
  ] as never;

  // Footprint circles — rel: 0 you, 1 ally, 2 enemy
  const footprints = useMemo<FeatureCollection>(() => {
    const feats: Feature<Polygon>[] = [];
    for (const p of players) {
      if (!p.homeSectorId) continue;
      const relation = playerRelation(p, me);
      const rel = relation === "self" ? 0 : relation === "ally" ? 1 : 2;
      if (p.house) {
        feats.push(
          circleFeature(p.house, HOUSE_FOOTPRINT_M, { rel, ghost: 0 })
        );
      }
      for (const b of p.buildings) {
        feats.push(
          circleFeature(
            { lat: b.lat, lng: b.lng },
            catalogItem(b.type).footprintM,
            { rel, ghost: 0 }
          )
        );
      }
    }
    if (placing && hover) {
      const fp = placingFootprint(placing.kind);
      const inSector = pointInRing(hover, placing.sector.ring);
      let clear = inSector;
      // Villager only needs to stand inside the sector
      if (clear && placing.kind !== "villager") {
        for (const p of players) {
          for (const b of p.buildings) {
            if (
              distMeters(hover, { lat: b.lat, lng: b.lng }) <
              fp + catalogItem(b.type).footprintM
            ) {
              clear = false;
              break;
            }
          }
          if (
            clear &&
            p.house &&
            distMeters(hover, p.house) < fp + HOUSE_FOOTPRINT_M
          ) {
            clear = false;
          }
          if (!clear) break;
        }
      }
      feats.push(
        circleFeature(hover, fp, { rel: 0, ghost: 1, ok: clear ? 1 : 0 })
      );
    }
    return { type: "FeatureCollection", features: feats };
  }, [players, me, placing, hover]);

  const mySpots = useMemo(() => {
    if (!me?.homeSectorId) return [];
    return spots.filter((s) => s.sectorId === me.homeSectorId);
  }, [spots, me]);

  /** Walking villagers for every settled player (mine + rivals) */
  const villagerMarkers = useMemo(() => {
    return players
      .filter(
        (p) =>
          p.homeSectorId &&
          p.villagers > 0 &&
          (p.house || p.villagerPost)
      )
      .map((p) => {
        const origin = p.villagerPost ?? p.house!;
        const sector = sectors.find((s) => s.id === p.homeSectorId);
        const easySpots = spots
          .filter((s) => s.sectorId === p.homeSectorId && s.kind === "easy")
          .map((s) => ({ lat: s.lat, lng: s.lng }));

        // Shared clock with a per-player offset so loops don't sync perfectly
        let offset = 0;
        for (let i = 0; i < p.id.length; i++) offset += p.id.charCodeAt(i);
        const phase =
          p.id === me?.id && me
            ? gatherPhase(me, now)
            : (((now + offset * 37) % GATHER_TRIP_MS) / GATHER_TRIP_MS);
        const tripIndex =
          p.id === me?.id && me
            ? gatherTripIndex(me, now)
            : Math.floor((now + offset * 37) / GATHER_TRIP_MS);

        const target = sector
          ? farmTargetForTrip(
              sector.ring,
              origin,
              easySpots,
              `${p.id}:${tripIndex}`
            )
          : easySpots[tripIndex % Math.max(1, easySpots.length)] ??
            offsetMeters(origin, 36, 18);

        const pose = gatherPose(phase);
        const relation = playerRelation(p, me);
        return {
          id: p.id,
          name: p.name,
          relation,
          villagers: p.villagers,
          pos: walkPosition(origin, target, phase),
          target,
          digging: pose === "dig",
          walking: pose === "walk",
        };
      });
  }, [players, spots, sectors, me, now]);

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

  // March animation position
  const marchPos = useMemo(() => {
    if (!march) return null;
    const t = Math.min(1, (now - march.startedAt) / march.durationMs);
    if (t >= 1) return null;
    return lerpLatLng(march.from, march.to, t);
  }, [march, now]);

  const trySpawn = useCallback(
    async (
      center: LatLng,
      z: number,
      b: number,
      meters: number,
      explored: number
    ) => {
      if (!onSpawnFind || !homeSector || spawning.current) return;
      if (Date.now() < localCooldownUntil.current) return;
      if (z < EXPLORE_ZOOM) return;
      if (!pointInRing(center, homeSector.ring)) return;
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
        setSpawnFlash("A resource appeared ahead!");
        window.setTimeout(() => setSpawnFlash(null), 2600);
        roamAcc.current = 0;
        exploreAcc.current = 0;
        setRoamMeters(0);
        setExploreMs(0);
        lastExploreTick.current = Date.now();
        localCooldownUntil.current = Date.now() + SPAWN_COOLDOWN_MS;
      } finally {
        spawning.current = false;
      }
    },
    [onSpawnFind, homeSector]
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
      // Country / city / road names only when fully zoomed into street detail
      applyBasemapLabels(z >= DETAIL_ZOOM);

      const inHome =
        Boolean(homeSector) && pointInRing(center, homeSector!.ring);
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
            setExploreMs(exploreAcc.current);
            setRoamMeters(roamAcc.current);
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

  const roamPct = Math.min(100, (roamMeters / ROAM_METERS_TO_SPAWN) * 100);
  const timePct = Math.min(100, (exploreMs / ROAM_MIN_EXPLORE_MS) * 100);
  const huntPct = Math.min(roamPct, timePct);

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
          longitude: 73.045,
          latitude: 33.71,
          zoom: INTRO_GLOBE_ZOOM,
          pitch: 0,
          bearing: 0,
        }}
        minZoom={introActive ? 0 : PLAY_MIN_ZOOM}
        maxZoom={PLAY_MAX_ZOOM}
        mapStyle="mapbox://styles/mapbox/standard"
        onLoad={(e) => {
          // Dusk atmosphere; Standard style ships 3D buildings by default
          const m = e.target;
          try {
            m.setConfigProperty("basemap", "lightPreset", "dusk");
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
        interactiveLayerIds={["sector-fill"]}
        cursor={placing ? "crosshair" : "grab"}
        onMove={onMove}
        onMouseMove={(e: MapMouseEvent) => {
          if (placing) {
            setHover({ lat: e.lngLat.lat, lng: e.lngLat.lng });
          }
        }}
        onClick={(e: MapMouseEvent) => {
          if (placing && onPlace) {
            onPlace(e.lngLat.lat, e.lngLat.lng);
            return;
          }
          const id = e.features?.[0]?.properties?.id;
          if (typeof id === "string") onSelect(id);
        }}
        style={{ width: "100%", height: "100%" }}
      >
        {/* Sector hit target + soft ownership wash (walls stay the main signal) */}
        <Source id="sectors" type="geojson" data={fc}>
          <Layer
            id="sector-fill"
            type="fill"
            slot="top"
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

        {/* Tall extruded wall band (no line stroke — avoids double edges) */}
        <Source id="sector-wall-bands" type="geojson" data={wallBandFc}>
          {SECTOR_WALL_STACK.map((band) => (
            <Layer
              key={band.id}
              id={band.id}
              type="fill-extrusion"
              slot="top"
              paint={{
                "fill-extrusion-color": sectorWallColor,
                "fill-extrusion-base": band.base,
                "fill-extrusion-height": [
                  "case",
                  ["==", ["get", "mine"], 1],
                  band.height + 24,
                  band.height,
                ] as never,
                "fill-extrusion-opacity": [
                  "case",
                  ["==", ["get", "mine"], 1],
                  Math.min(0.95, band.opacity + 0.06),
                  band.opacity,
                ] as never,
                "fill-extrusion-vertical-gradient": true,
              }}
            />
          ))}
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
                      selectedPlayerId === p.id ? "is-selected" : ""
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canTarget) onSelectPlayer?.(p.id);
                      else onSelectPlayer?.(null);
                    }}
                    title={
                      relation === "self"
                        ? "You"
                        : relation === "ally"
                          ? `${p.name} (ally — same sector)`
                          : `Tap to target ${p.name}`
                    }
                    aria-label={relation === "self" ? "You" : p.name}
                  >
                    {relation === "self" && (
                      <span className="player-pin-name">You</span>
                    )}
                    <span className="player-pin-dot" />
                  </button>
                </Marker>
              );
            })}

        {/* Detail: footprints, houses, buildings, villagers, resources */}
        {showDetail && (
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
                    ["case", ["==", ["get", "ok"], 1], "#3b9eff", "#e23b2f"],
                    ["==", ["get", "rel"], 0],
                    "#3b9eff",
                    ["==", ["get", "rel"], 1],
                    "#3ddb7a",
                    "#e23b2f",
                  ] as never,
                  "fill-opacity": [
                    "case",
                    ["==", ["get", "ghost"], 1],
                    0.3,
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
                    ["case", ["==", ["get", "ok"], 1], "#7ec8ff", "#ff5245"],
                    ["==", ["get", "rel"], 0],
                    "#3b9eff",
                    ["==", ["get", "rel"], 1],
                    "#4dff8a",
                    "#e23b2f",
                  ] as never,
                  "line-width": [
                    "case",
                    ["==", ["get", "ghost"], 1],
                    2,
                    1,
                  ] as never,
                  "line-dasharray": [2, 1.5] as never,
                }}
              />
            </Source>

            {players
              .filter((p) => p.homeSectorId && p.house)
              .map((p) => (
                <Marker
                  key={`house-${p.id}`}
                  longitude={p.house!.lng}
                  latitude={p.house!.lat}
                  anchor="bottom"
                >
                  <button
                    type="button"
                    className={`relative flex flex-col items-center bg-transparent p-0 ${
                      selectedPlayerId === p.id
                        ? "ring-2 ring-[var(--sand)] rounded-sm"
                        : ""
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
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
                      p.id === me?.id
                        ? "Your house"
                        : p.homeSectorId &&
                            me?.homeSectorId &&
                            p.homeSectorId === me.homeSectorId
                          ? `${p.name} (same sector — can't attack)`
                          : `Tap to target ${p.name}`
                    }
                  >
                    <HouseSprite className="h-10 w-11 drop-shadow-md" />
                    <HpBar
                      hp={p.houseHp ?? HOUSE_MAX_HP}
                      maxHp={HOUSE_MAX_HP}
                      width={38}
                    />
                  </button>
                </Marker>
              ))}

            {players
              .filter((p) => p.homeSectorId)
              .flatMap((p) =>
                p.buildings.map((b) => {
                  const maxHp = catalogItem(b.type).hp;
                  const canTarget =
                    p.id !== me?.id &&
                    Boolean(p.homeSectorId) &&
                    Boolean(me?.homeSectorId) &&
                    p.homeSectorId !== me?.homeSectorId;
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
                          selectedPlayerId === p.id
                            ? "ring-2 ring-[var(--sand)] rounded-sm"
                            : ""
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (canTarget) onSelectPlayer?.(p.id);
                          else onSelectPlayer?.(null);
                        }}
                        title={
                          p.id === me?.id
                            ? `Your ${catalogItem(b.type).name}`
                            : canTarget
                              ? `Tap to target ${p.name}`
                              : `${p.name} (same sector — can't attack)`
                        }
                      >
                        <BuildingSprite type={b.type} />
                        <HpBar hp={b.hp ?? maxHp} maxHp={maxHp} width={38} />
                        {playerRelation(p, me) === "enemy" && (
                          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[var(--signal-bright)] ring-1 ring-[var(--surface)]" />
                        )}
                        {playerRelation(p, me) === "ally" && (
                          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[var(--field-bright)] ring-1 ring-[var(--surface)]" />
                        )}
                      </button>
                    </Marker>
                  );
                })
              )}

            {players
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
                return (
                  <Marker
                    key={s.id}
                    longitude={s.lng}
                    latitude={s.lat}
                    anchor="center"
                  >
                    <ResourceNode
                      gem={gem}
                      size={ready ? 40 : 32}
                      depleted={!ready}
                      pulse={ready}
                      title={
                        ready
                          ? `${GEM_META[gem].label} — tap to collect`
                          : `${GEM_META[gem].label} refilling…`
                      }
                      onClick={() => {
                        if (ready) onCollectHidden?.(s.id);
                      }}
                    />
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
                      ? `${v.name}'s villager farming`
                      : `${v.name}'s villager`
                  }
                >
                  <span
                    className={`absolute -top-3.5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-sm px-1 font-mono text-[8px] ${
                      v.relation === "self"
                        ? "bg-[rgba(10,14,18,0.85)] text-[#7ec8ff]"
                        : v.relation === "ally"
                          ? "bg-[rgba(10,14,10,0.85)] text-[var(--field-bright)] ring-1 ring-[var(--field)]"
                          : "bg-[rgba(10,14,10,0.9)] text-[var(--signal-bright)] ring-1 ring-[var(--signal)]"
                    }`}
                  >
                    {v.relation === "self" ? "You" : v.name}
                  </span>
                  <VillagerSprite
                    walking={v.walking}
                    digging={v.digging}
                    className="h-10 w-10 drop-shadow-md"
                  />
                  {v.digging && <span className="villager-dirt" aria-hidden />}
                  {v.villagers > 1 && (
                    <span className="absolute -right-1 -top-1 rounded-full bg-[var(--surface)] px-1 font-mono text-[9px] text-[var(--field-bright)]">
                      ×{v.villagers}
                    </span>
                  )}
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

        {/* Exact GPS while selecting / claiming a sector */}
        {userLocation && (
          <Marker
            longitude={userLocation.lng}
            latitude={userLocation.lat}
            anchor="center"
          >
            <div className="you-are-here" title="Your location">
              <span className="you-are-here-pulse" />
              <span className="you-are-here-dot" />
              <span className="you-are-here-label">You</span>
            </div>
          </Marker>
        )}

        {/* Incoming rocket salvo */}
        {marchPos && (
          <Marker
            longitude={marchPos.lng}
            latitude={marchPos.lat}
            anchor="bottom"
          >
            <div className="relative flex items-end">
              <RocketSprite className="h-9 w-9 rocket-march" />
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 font-mono text-[9px] text-[var(--signal-bright)]">
                ✦
              </span>
            </div>
          </Marker>
        )}

        {/* Attack impact explosion */}
        {impact && now - impact.startedAt < IMPACT_DURATION_MS && (
          <Marker
            longitude={impact.at.lng}
            latitude={impact.at.lat}
            anchor="center"
          >
            <div className="impact-burst">
              <span className="impact-ring" />
              <span className="impact-ring impact-ring-2" />
              <span className="impact-flash">💥</span>
            </div>
          </Marker>
        )}
      </MapboxMap>

      {/* Guided placement beacon — blinks in the sector while planting */}
      {guidePulse && placing && (
        <Marker
          latitude={ringCentroid(placing.sector.ring).lat}
          longitude={ringCentroid(placing.sector.ring).lng}
          anchor="center"
        >
          <div className="guide-map-beacon" aria-hidden />
        </Marker>
      )}

      {/* Placement banner */}
      {placing && (
        <div
          data-guide="guide-place-banner"
          className="pointer-events-none absolute left-1/2 top-14 z-10 -translate-x-1/2"
        >
          <p className="hud-chip px-4 py-2 text-center text-xs font-semibold text-[var(--sand)]">
            Tap inside {placing.sector.name} to place your{" "}
            {placingLabel(placing.kind)} — green ring = clear ground
          </p>
        </div>
      )}

      {me?.homeSectorId && !placing && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 z-10 w-[min(22rem,calc(100%-1rem))] -translate-x-1/2 space-y-2 sm:bottom-4">
          {spawnFlash && (
            <p className="hud-chip px-3 py-2 text-center text-xs font-semibold text-[var(--field-bright)]">
              {spawnFlash}
            </p>
          )}
          {!showDetail ? (
            <p className="hud-chip px-3 py-1.5 text-center font-mono text-[9px] text-[var(--ink-muted)]">
              Overview — sector economy · zoom in for 3D streets & settlements
            </p>
          ) : zoom < EXPLORE_ZOOM ? (
            <p className="hud-chip px-3 py-1.5 text-center font-mono text-[9px] text-[var(--ink-muted)]">
              Zoom into {homeSector?.name ?? "your sector"} & roam for
              resources · trip {Math.round(GATHER_TRIP_MS / 1000)}s
            </p>
          ) : exploring ? (
            <div className="hud-chip px-3 py-1.5">
              <p className="text-center font-mono text-[9px] text-[var(--sand)]">
                Exploring — resources appear ahead as you roam
              </p>
              <div className="mx-auto mt-1 h-1.5 max-w-xs overflow-hidden rounded-full bg-[var(--wash)]">
                <div
                  className="h-full bg-[var(--sand)] transition-[width] duration-150"
                  style={{ width: `${huntPct}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="hud-chip px-3 py-1.5 text-center font-mono text-[9px] text-[var(--ink-muted)]">
              Pan into your sector while zoomed in to hunt resources
            </p>
          )}
        </div>
      )}
    </div>
  );
}
