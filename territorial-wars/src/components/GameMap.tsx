"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapboxMap, { Layer, Marker, Source } from "react-map-gl/mapbox";
import type { MapMouseEvent, MapRef } from "react-map-gl/mapbox";
import type { FeatureCollection } from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import type {
  Building,
  LatLng,
  Player,
  ResourceSpot,
  Sector,
} from "@/lib/gameTypes";
import {
  EXPLORE_ZOOM,
  GATHER_TRIP_MS,
  GEM_META,
  ROAM_METERS_TO_SPAWN,
} from "@/lib/gameTypes";
import { pointInRing } from "@/lib/geo";
import { distMeters, lerpLatLng } from "@/lib/mapMath";
import { gatherPhase } from "@/lib/rules";
import { HouseSprite, VillagerSprite } from "@/components/sprites";
import { ResourceGem } from "@/components/ResourceGem";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

type Props = {
  sectors: Sector[];
  spots: ResourceSpot[];
  me: Player | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSpawnFind?: (payload: {
    lat: number;
    lng: number;
    bearing: number;
    zoom: number;
    roamMeters: number;
  }) => void | Promise<void>;
  onCollectHidden?: (spotId: string) => void;
  className?: string;
};

function buildingLabel(type: Building["type"]): string {
  if (type === "mill") return "Mill";
  if (type === "warehouse") return "Store";
  return "Well";
}

/** Outbound 0–0.45, gather pause 0.45–0.55, return 0.55–1 */
function walkPosition(house: LatLng, target: LatLng, phase: number): LatLng {
  if (phase < 0.45) return lerpLatLng(house, target, phase / 0.45);
  if (phase < 0.55) return target;
  return lerpLatLng(target, house, (phase - 0.55) / 0.45);
}

export function GameMap({
  sectors,
  spots,
  me,
  selectedId,
  onSelect,
  onSpawnFind,
  onCollectHidden,
  className = "",
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const [zoom, setZoom] = useState(12.2);
  const [now, setNow] = useState(() => Date.now());
  const [roamMeters, setRoamMeters] = useState(0);
  const [exploring, setExploring] = useState(false);
  const [spawnFlash, setSpawnFlash] = useState<string | null>(null);
  const lastCenter = useRef<LatLng | null>(null);
  const spawning = useRef(false);
  const roamAcc = useRef(0);

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
        ...{
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
        },
      })),
    }),
    [sectors, me]
  );

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
  const villagerPos =
    me?.house && easyTarget
      ? walkPosition(me.house, easyTarget, phase)
      : null;

  const trySpawn = useCallback(
    async (center: LatLng, z: number, b: number, meters: number) => {
      if (!onSpawnFind || !homeSector || spawning.current) return;
      if (z < EXPLORE_ZOOM) return;
      if (!pointInRing(center, homeSector.ring)) return;
      if (meters < ROAM_METERS_TO_SPAWN) return;
      spawning.current = true;
      try {
        await onSpawnFind({
          lat: center.lat,
          lng: center.lng,
          bearing: b,
          zoom: z,
          roamMeters: meters,
        });
        setSpawnFlash("A gem appeared ahead!");
        window.setTimeout(() => setSpawnFlash(null), 2600);
        roamAcc.current = 0;
        setRoamMeters(0);
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
        lastCenter.current = deep ? center : null;
        return;
      }

      if (lastCenter.current) {
        const d = distMeters(lastCenter.current, center);
        // Ignore tiny jitter / huge jumps (teleport)
        if (d > 0.8 && d < 120) {
          roamAcc.current += d;
          setRoamMeters(roamAcc.current);
        }
      }
      lastCenter.current = center;

      if (roamAcc.current >= ROAM_METERS_TO_SPAWN) {
        void trySpawn(center, z, b, roamAcc.current);
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
        onMove={onMove}
        onClick={(e: MapMouseEvent) => {
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

        {me?.house && (
          <Marker
            longitude={me.house.lng}
            latitude={me.house.lat}
            anchor="bottom"
          >
            <HouseSprite className="h-10 w-11 drop-shadow-md" />
          </Marker>
        )}

        {me?.buildings.map((b) => (
          <Marker
            key={b.id}
            longitude={b.lng}
            latitude={b.lat}
            anchor="bottom"
          >
            <div className="rounded-sm bg-[var(--surface)]/85 px-1.5 py-0.5 font-mono text-[9px] text-[var(--sand)]">
              {buildingLabel(b.type)}
            </div>
          </Marker>
        ))}

        {/* Easy gems near house — always visible in your sector */}
        {mySpots
          .filter((s) => s.kind === "easy")
          .map((s) => (
            <Marker
              key={s.id}
              longitude={s.lng}
              latitude={s.lat}
              anchor="center"
            >
              <ResourceGem gem={s.gem || "amber"} size={28} pulse />
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
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  if (ready) onCollectHidden?.(s.id);
                }}
              >
                <ResourceGem
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
      </MapboxMap>

      {me?.homeSectorId && (
        <div className="pointer-events-none absolute bottom-3 left-3 right-3 space-y-2">
          {spawnFlash && (
            <p className="rounded-sm bg-[var(--field)]/25 px-3 py-2 text-center text-xs font-semibold text-[var(--field-bright)]">
              {spawnFlash}
            </p>
          )}
          {zoom < EXPLORE_ZOOM ? (
            <p className="rounded-sm bg-[var(--surface)]/90 px-3 py-2 text-center font-mono text-[10px] text-[var(--ink-muted)]">
              Zoom fully into {homeSector?.name ?? "your sector"} and roam to
              uncover diamonds & gems · trip {Math.round(GATHER_TRIP_MS / 1000)}s
            </p>
          ) : exploring ? (
            <div className="rounded-sm bg-[var(--surface)]/90 px-3 py-2">
              <p className="text-center font-mono text-[10px] text-[var(--sand)]">
                Exploring · pan around — gems appear ahead of you
              </p>
              <div className="mx-auto mt-1.5 h-1.5 max-w-xs overflow-hidden rounded-full bg-[var(--wash)]">
                <div
                  className="h-full bg-[var(--sand)] transition-[width] duration-150"
                  style={{ width: `${roamPct}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="rounded-sm bg-[var(--surface)]/90 px-3 py-2 text-center font-mono text-[10px] text-[var(--ink-muted)]">
              Pan into your sector while zoomed in to hunt gems
            </p>
          )}
        </div>
      )}
    </div>
  );
}
