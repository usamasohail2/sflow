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
  EXPLORE_ZOOM,
  GATHER_TRIP_MS,
  GEM_META,
  HOUSE_FOOTPRINT_M,
  ROAM_METERS_TO_SPAWN,
  ROAM_MIN_EXPLORE_MS,
  SPAWN_COOLDOWN_MS,
  catalogItem,
} from "@/lib/gameTypes";
import { pointInRing } from "@/lib/geo";
import { distMeters, lerpLatLng, offsetMeters } from "@/lib/mapMath";
import { gatherPhase } from "@/lib/rules";
import {
  HouseSprite,
  MillSprite,
  SoldierSprite,
  TankSprite,
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
  march: MarchAnim | null;
  onSelect: (id: string) => void;
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

/** Outbound 0–0.45, gather pause 0.45–0.55, return 0.55–1 */
function walkPosition(house: LatLng, target: LatLng, phase: number): LatLng {
  if (phase < 0.45) return lerpLatLng(house, target, phase / 0.45);
  if (phase < 0.55) return target;
  return lerpLatLng(target, house, (phase - 0.55) / 0.45);
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
  march,
  onSelect,
  onPlace,
  onSpawnFind,
  onCollectHidden,
  className = "",
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const [zoom, setZoom] = useState(12.2);
  const [now, setNow] = useState(() => Date.now());
  const [roamMeters, setRoamMeters] = useState(0);
  const [exploreMs, setExploreMs] = useState(0);
  const [exploring, setExploring] = useState(false);
  const [spawnFlash, setSpawnFlash] = useState<string | null>(null);
  const [hover, setHover] = useState<LatLng | null>(null);
  const lastCenter = useRef<LatLng | null>(null);
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

  const easyTarget = useMemo(() => {
    const easy = mySpots.find((s) => s.kind === "easy");
    if (easy) return { lat: easy.lat, lng: easy.lng };
    return me?.house ?? null;
  }, [mySpots, me]);

  const phase = me ? gatherPhase(me, now) : 0;
  const walkOrigin = me?.villagerPost ?? me?.house ?? null;
  const villagerPos =
    walkOrigin && easyTarget
      ? walkPosition(walkOrigin, easyTarget, phase)
      : null;

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
          zoom: 12.2,
          pitch: 50,
          bearing: -28,
        }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
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
        <Source id="sectors" type="geojson" data={fc}>
          <Layer
            id="sector-fill"
            type="fill"
            paint={{
              "fill-color": [
                "case",
                ["==", ["get", "mine"], 1],
                "#3d6b45",
                ["==", ["get", "id"], selectedId || ""],
                "#e23b2f",
                "#2a3530",
              ] as never,
              "fill-opacity": exploring ? 0.18 : 0.34,
            }}
          />
          <Layer
            id="sector-line"
            type="line"
            paint={{
              "line-color": exploring ? "#7ec8ff" : "#e8ebe4",
              "line-width": exploring ? 2 : 2.5,
            }}
          />
          <Layer
            id="sector-label"
            type="symbol"
            layout={{
              "text-field": ["get", "name"],
              "text-size": 13,
              "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
            }}
            paint={{
              "text-color": "#e8ebe4",
              "text-halo-color": "#0c100e",
              "text-halo-width": 1.2,
              "text-opacity": exploring ? 0.35 : 1,
            }}
          />
        </Source>

        {/* Building footprints (visible when zoomed in a bit) */}
        {zoom >= 13.4 && (
          <Source id="footprints" type="geojson" data={footprints}>
            <Layer
              id="footprint-fill"
              type="fill"
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
        )}

        {/* All settlements: houses + buildings (mine and rivals) */}
        {players
          .filter((p) => p.homeSectorId && p.house)
          .map((p) => (
            <Marker
              key={`house-${p.id}`}
              longitude={p.house!.lng}
              latitude={p.house!.lat}
              anchor="bottom"
            >
              <div className="relative">
                <HouseSprite className="h-10 w-11 drop-shadow-md" />
                {p.id !== me?.id && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-sm bg-[rgba(10,14,10,0.85)] px-1 font-mono text-[8px] text-[var(--signal-bright)]">
                    {p.name}
                  </span>
                )}
              </div>
            </Marker>
          ))}
        {players
          .filter((p) => p.homeSectorId)
          .flatMap((p) =>
            p.buildings.map((b) => (
              <Marker
                key={b.id}
                longitude={b.lng}
                latitude={b.lat}
                anchor="bottom"
              >
                <div className="relative">
                  <BuildingSprite type={b.type} />
                  {p.id !== me?.id && (
                    <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[var(--signal-bright)] ring-1 ring-[var(--surface)]" />
                  )}
                </div>
              </Marker>
            ))
          )}

        {/* Soldiers garrison (mine + rivals) */}
        {players
          .filter((p) => p.homeSectorId && p.house && p.soldiers > 0)
          .map((p) => {
            const pos = offsetMeters(p.house!, 26, -12);
            return (
              <Marker
                key={`army-${p.id}`}
                longitude={pos.lng}
                latitude={pos.lat}
                anchor="bottom"
              >
                <div className="relative">
                  <SoldierSprite className="h-8 w-8" />
                  <span className="absolute -right-1.5 -top-1 rounded-full bg-[var(--surface)] px-1 font-mono text-[9px] text-[#ff9d5a]">
                    ×{p.soldiers}
                  </span>
                </div>
              </Marker>
            );
          })}

        {/* Tank garrison (mine + rivals) */}
        {players
          .filter((p) => p.homeSectorId && p.house && p.tanks > 0)
          .map((p) => {
            const pos = offsetMeters(p.house!, -30, -16);
            return (
              <Marker
                key={`tanks-${p.id}`}
                longitude={pos.lng}
                latitude={pos.lat}
                anchor="bottom"
              >
                <div className="relative">
                  <TankSprite className="h-8 w-10" />
                  <span className="absolute -right-1.5 -top-1 rounded-full bg-[var(--surface)] px-1 font-mono text-[9px] text-[#ff9d5a]">
                    ×{p.tanks}
                  </span>
                </div>
              </Marker>
            );
          })}

        {/* Easy resources near house — trees & rocks */}
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

        {/* Roam-found gems */}
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

        {/* Walking villager */}
        {villagerPos && me && me.villagers > 0 && (
          <Marker
            longitude={villagerPos.lng}
            latitude={villagerPos.lat}
            anchor="bottom"
          >
            <div className="relative">
              <VillagerSprite walking className="h-9 w-9" />
              {me.villagers > 1 && (
                <span className="absolute -right-1 -top-1 rounded-full bg-[var(--surface)] px-1 font-mono text-[9px] text-[var(--field-bright)]">
                  ×{me.villagers}
                </span>
              )}
            </div>
          </Marker>
        )}

        {/* Pending house during claim flow */}
        {previewHouse && (
          <Marker
            longitude={previewHouse.lng}
            latitude={previewHouse.lat}
            anchor="bottom"
          >
            <HouseSprite className="h-10 w-11 opacity-70" />
          </Marker>
        )}

        {/* Marching army */}
        {marchPos && (
          <Marker
            longitude={marchPos.lng}
            latitude={marchPos.lat}
            anchor="bottom"
          >
            <div className="relative flex items-end">
              {me && me.tanks > 0 && <TankSprite className="h-8 w-10 -mr-2" />}
              <SoldierSprite className="h-9 w-9" />
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 font-mono text-[9px] text-[var(--signal-bright)]">
                ⚔
              </span>
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
          {zoom < EXPLORE_ZOOM ? (
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
