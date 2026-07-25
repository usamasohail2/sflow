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
  PLAY_MAX_ZOOM,
  PLAY_MIN_ZOOM,
  PLAY_ZOOM,
  ROAM_METERS_TO_SPAWN,
  ROAM_MIN_EXPLORE_MS,
  SPAWN_COOLDOWN_MS,
  catalogItem,
} from "@/lib/gameTypes";
import { closeRing, pointInRing } from "@/lib/geo";
import {
  distMeters,
  farmTargetForTrip,
  lerpLatLng,
  offsetMeters,
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
  className = "",
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const [zoom, setZoom] = useState(PLAY_ZOOM);
  const showDetail = zoom >= DETAIL_ZOOM;
  const [now, setNow] = useState(() => Date.now());
  const [roamMeters, setRoamMeters] = useState(0);
  const [exploreMs, setExploreMs] = useState(0);
  const [exploring, setExploring] = useState(false);
  const [spawnFlash, setSpawnFlash] = useState<string | null>(null);
  const [hover, setHover] = useState<LatLng | null>(null);
  const lastCenter = useRef<LatLng | null>(null);
  const lastFlownGps = useRef<string | null>(null);
  const spawning = useRef(false);
  const roamAcc = useRef(0);
  const exploreAcc = useRef(0);
  const lastExploreTick = useRef<number | null>(null);
  const localCooldownUntil = useRef(0);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 80);
    return () => window.clearInterval(id);
  }, []);

  // Fly to the player's GPS once when it first appears (not on every watch tick)
  useEffect(() => {
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
      duration: 1200,
      essential: true,
    });
  }, [userLocation]);

  // Re-center when picking a sector, or when parent requests focus (GPS confirm)
  useEffect(() => {
    if (!userLocation) return;
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      center: [userLocation.lng, userLocation.lat],
      zoom: Math.min(
        PLAY_MAX_ZOOM,
        Math.max(map.getZoom(), PLAY_ZOOM)
      ),
      duration: 800,
    });
  }, [selectedId, userLocationFocus]); // eslint-disable-line react-hooks/exhaustive-deps

  const homeSector = useMemo(
    () => sectors.find((s) => s.id === me?.homeSectorId) ?? null,
    [sectors, me]
  );

  const fc = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: sectors.map((s) => ({
        type: "Feature" as const,
        id: s.id,
        properties: {
          id: s.id,
          name: s.name,
          mine: me?.homeSectorId === s.id ? 1 : 0,
        },
        geometry: {
          type: "Polygon" as const,
          coordinates: [s.ring],
        },
      })),
    }),
    [sectors, me]
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

  /** Home = bright green; rivals = bright coral; selected before settle = gold */
  const settled = Boolean(me?.homeSectorId);
  const sectorWallColor = [
    "case",
    ["==", ["get", "mine"], 1],
    exploring ? "#7ef0ff" : "#4dff8a",
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
    "#3ddb7a",
    ["==", ["get", "id"], selectedId || ""],
    settled ? "#ff5a45" : "#ffd060",
    settled ? "#ff4d3d" : "#8a8578",
  ] as never;

  const sectorLabelColor = [
    "case",
    ["==", ["get", "mine"], 1],
    "#b8ffd0",
    ["==", ["get", "id"], selectedId || ""],
    settled ? "#ffc4b8" : "#ffe6a0",
    settled ? "#ffb0a4" : "#f0f2ea",
  ] as never;

  // Footprint circles for every settlement on the map (+ placement ghost)
  const footprints = useMemo<FeatureCollection>(() => {
    const feats: Feature<Polygon>[] = [];
    for (const p of players) {
      if (!p.homeSectorId) continue;
      const mine = p.id === me?.id ? 1 : 0;
      if (p.house) {
        feats.push(
          circleFeature(p.house, HOUSE_FOOTPRINT_M, { mine, ghost: 0 })
        );
      }
      for (const b of p.buildings) {
        feats.push(
          circleFeature(
            { lat: b.lat, lng: b.lng },
            catalogItem(b.type).footprintM,
            { mine, ghost: 0 }
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
        circleFeature(hover, fp, { mine: 1, ghost: 1, ok: clear ? 1 : 0 })
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
        return {
          id: p.id,
          name: p.name,
          mine: p.id === me?.id,
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
    [homeSector, me, trySpawn]
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
      <MapboxMap
        ref={mapRef}
        mapboxAccessToken={TOKEN}
        initialViewState={{
          longitude: 73.045,
          latitude: 33.71,
          zoom: PLAY_ZOOM,
          pitch: 55,
          bearing: -28,
        }}
        minZoom={PLAY_MIN_ZOOM}
        maxZoom={PLAY_MAX_ZOOM}
        mapStyle="mapbox://styles/mapbox/standard"
        onLoad={(e) => {
          // Dusk atmosphere; Standard style ships 3D buildings by default
          const m = e.target as unknown as {
            setConfigProperty: (
              scope: string,
              key: string,
              value: unknown
            ) => void;
          };
          try {
            m.setConfigProperty("basemap", "lightPreset", "dawn");
            m.setConfigProperty("basemap", "show3dObjects", true);
          } catch {
            /* older style fallback — ignore */
          }
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
          <Layer
            id="sector-label"
            type="symbol"
            slot="top"
            layout={{
              "text-field": ["get", "name"],
              "text-size": 13,
              "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
            }}
            paint={{
              "text-color": sectorLabelColor,
              "text-halo-color": "#0c100e",
              "text-halo-width": 1.2,
              "text-opacity": exploring ? 0.35 : 1,
            }}
          />
        </Source>

        {/* Single perimeter wall: soft glow + crisp stroke (gradient feel) */}
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

        {/* Overview: zoomed-out player pins (dot + name + info) */}
        {!showDetail &&
          players
            .filter((p) => p.homeSectorId)
            .map((p) => {
              const at = playerAnchor(p);
              if (!at) return null;
              const mine = p.id === me?.id;
              const sameSector =
                Boolean(p.homeSectorId) &&
                Boolean(me?.homeSectorId) &&
                p.homeSectorId === me?.homeSectorId;
              const canTarget =
                !mine &&
                Boolean(p.homeSectorId) &&
                Boolean(me?.homeSectorId) &&
                !sameSector;
              const houseUp = Boolean(p.house) && (p.houseHp ?? 0) > 0;
              const info = [
                `${p.rockets || 0}🚀`,
                `${p.gold}g`,
                !houseUp ? "razed" : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <Marker
                  key={`pin-${p.id}`}
                  longitude={at.lng}
                  latitude={at.lat}
                  anchor="center"
                >
                  <button
                    type="button"
                    className={`player-pin ${mine ? "is-mine" : "is-rival"} ${
                      selectedPlayerId === p.id ? "is-selected" : ""
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canTarget) onSelectPlayer?.(p.id);
                      else onSelectPlayer?.(null);
                    }}
                    title={
                      mine
                        ? "You"
                        : sameSector
                          ? `${p.name} (same sector — can't attack)`
                          : `Tap to target ${p.name}`
                    }
                  >
                    <span className="player-pin-dot" />
                    <span className="player-pin-name">
                      {mine ? "You" : p.name}
                    </span>
                    <span className="player-pin-info">{info}</span>
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
                    ["case", ["==", ["get", "ok"], 1], "#5a9a63", "#e23b2f"],
                    ["==", ["get", "mine"], 1],
                    "#5a9a63",
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
                    ["case", ["==", ["get", "ok"], 1], "#8fe098", "#ff5245"],
                    ["==", ["get", "mine"], 1],
                    "#5a9a63",
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
                  return (
                    <Marker
                      key={b.id}
                      longitude={b.lng}
                      latitude={b.lat}
                      anchor="bottom"
                    >
                      <div className="relative flex flex-col items-center">
                        <BuildingSprite type={b.type} />
                        <HpBar hp={b.hp ?? maxHp} maxHp={maxHp} width={38} />
                        {p.id !== me?.id && (
                          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[var(--signal-bright)] ring-1 ring-[var(--surface)]" />
                        )}
                      </div>
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
                  className={`relative ${v.mine ? "" : "rival-villager"}`}
                  title={
                    v.digging
                      ? `${v.name}'s villager farming`
                      : `${v.name}'s villager`
                  }
                >
                  <span
                    className={`absolute -top-3.5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-sm px-1 font-mono text-[8px] ${
                      v.mine
                        ? "bg-[rgba(10,14,10,0.85)] text-[var(--field-bright)]"
                        : "bg-[rgba(10,14,10,0.9)] text-[var(--signal-bright)] ring-1 ring-[var(--signal)]"
                    }`}
                  >
                    {v.mine ? "You" : v.name}
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

      {/* Placement banner */}
      {placing && (
        <div className="pointer-events-none absolute left-1/2 top-14 z-10 -translate-x-1/2">
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
              Overview — dots show settlers · zoom in for houses & villagers
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
