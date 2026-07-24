"use client";

import { useEffect, useMemo, useState } from "react";
import MapboxMap, { Layer, Marker, Source } from "react-map-gl/mapbox";
import type { MapMouseEvent, MapRef } from "react-map-gl/mapbox";
import type { FeatureCollection } from "geojson";
import { useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import type {
  Building,
  LatLng,
  Player,
  ResourceSpot,
  Sector,
} from "@/lib/gameTypes";
import { GATHER_TRIP_MS } from "@/lib/gameTypes";
import { ringToFeature } from "@/lib/geo";
import { lerpLatLng } from "@/lib/mapMath";
import { gatherPhase } from "@/lib/rules";
import { HouseSprite, VillagerSprite } from "@/components/sprites";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
/** Hidden spots only appear / are clickable at this zoom+ */
const HIDDEN_ZOOM = 14.2;

type Props = {
  sectors: Sector[];
  spots: ResourceSpot[];
  me: Player | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDiscoverSpot?: (spotId: string) => void;
  onCollectHidden?: (spotId: string) => void;
  className?: string;
};

function buildingLabel(type: Building["type"]): string {
  if (type === "mill") return "Mill";
  if (type === "warehouse") return "Store";
  return "Well";
}

/** Outbound 0–0.45, gather pause 0.45–0.55, return 0.55–1 */
function walkPosition(
  house: LatLng,
  target: LatLng,
  phase: number
): LatLng {
  if (phase < 0.45) {
    return lerpLatLng(house, target, phase / 0.45);
  }
  if (phase < 0.55) return target;
  return lerpLatLng(target, house, (phase - 0.55) / 0.45);
}

export function GameMap({
  sectors,
  spots,
  me,
  selectedId,
  onSelect,
  onDiscoverSpot,
  onCollectHidden,
  className = "",
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const [zoom, setZoom] = useState(12.2);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 80);
    return () => window.clearInterval(id);
  }, []);

  const fc = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: sectors.map((s) => ({
          ...ringToFeature(s.id, s.name, s.ring),
          properties: {
            id: s.id,
            name: s.name,
            mine: me?.homeSectorId === s.id ? 1 : 0,
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
      <MapboxMap
        ref={mapRef}
        mapboxAccessToken={TOKEN}
        initialViewState={{
          longitude: 73.045,
          latitude: 33.71,
          zoom: 12.2,
          pitch: 45,
          bearing: -28,
        }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        interactiveLayerIds={["sector-fill"]}
        onMove={(e) => setZoom(e.viewState.zoom)}
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
              "fill-opacity": 0.34,
            }}
          />
          <Layer
            id="sector-line"
            type="line"
            paint={{
              "line-color": "#e8ebe4",
              "line-width": 2.5,
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
            }}
          />
        </Source>

        {/* House */}
        {me?.house && (
          <Marker
            longitude={me.house.lng}
            latitude={me.house.lat}
            anchor="bottom"
          >
            <HouseSprite className="h-10 w-11 drop-shadow-md" />
          </Marker>
        )}

        {/* Buildings */}
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

        {/* Easy resource nodes */}
        {mySpots
          .filter((s) => s.kind === "easy")
          .map((s) => (
            <Marker
              key={s.id}
              longitude={s.lng}
              latitude={s.lat}
              anchor="center"
            >
              <span
                className="block h-2.5 w-2.5 rounded-full bg-[var(--sand)] ring-2 ring-[var(--surface)]"
                title="Nearby resource"
              />
            </Marker>
          ))}

        {/* Hidden: only when zoomed in */}
        {zoom >= HIDDEN_ZOOM &&
          mySpots
            .filter((s) => s.kind === "hidden")
            .map((s) => {
              const found = me?.discoveredSpotIds.includes(s.id);
              const ready = s.availableAt <= now;
              if (!found) {
                return (
                  <Marker
                    key={s.id}
                    longitude={s.lng}
                    latitude={s.lat}
                    anchor="center"
                    onClick={(e) => {
                      e.originalEvent.stopPropagation();
                      onDiscoverSpot?.(s.id);
                    }}
                  >
                    <button
                      type="button"
                      className="h-3 w-3 rounded-full bg-[var(--signal-bright)]/70 ring-2 ring-[var(--signal)] animate-pulse"
                      title="Hidden cache — tap to discover"
                    />
                  </Marker>
                );
              }
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
                  <button
                    type="button"
                    className={`h-3.5 w-3.5 rounded-full ring-2 ring-[var(--surface)] ${
                      ready
                        ? "bg-[var(--field-bright)]"
                        : "bg-[var(--ink-faint)] opacity-50"
                    }`}
                    title={
                      ready
                        ? "Cache ready — tap to collect"
                        : "Refilling…"
                    }
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
      </MapboxMap>

      {me?.homeSectorId && zoom < HIDDEN_ZOOM && (
        <p className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-sm bg-[var(--surface)]/85 px-3 py-2 text-center font-mono text-[10px] text-[var(--ink-muted)]">
          Zoom into your sector to hunt hidden caches · trip{" "}
          {Math.round(GATHER_TRIP_MS / 1000)}s
        </p>
      )}
    </div>
  );
}
