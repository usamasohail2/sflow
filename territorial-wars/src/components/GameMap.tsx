"use client";

import { useMemo } from "react";
import MapboxMap, { Layer, Marker, Source } from "react-map-gl/mapbox";
import type { MapMouseEvent } from "react-map-gl/mapbox";
import type { FeatureCollection } from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Sector, SectorEconomy } from "@/lib/gameTypes";
import { ringToFeature } from "@/lib/geo";
import { HouseSprite, VillagerSprite } from "@/components/sprites";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

export type SectorPresence = {
  sectorId: string;
  villagers: number;
  houses: number;
};

type Props = {
  sectors: Sector[];
  economies: Record<string, SectorEconomy>;
  presence?: SectorPresence[];
  selectedId: string | null;
  myLocation: { lat: number; lng: number } | null;
  onSelect: (id: string) => void;
  onMapPlaceLocation?: (lat: number, lng: number) => void;
  className?: string;
};

function sectorCenter(sector: Sector): { lat: number; lng: number } {
  const ring = sector.ring.slice(0, -1);
  const lng = ring.reduce((s, p) => s + p[0], 0) / Math.max(1, ring.length);
  const lat = ring.reduce((s, p) => s + p[1], 0) / Math.max(1, ring.length);
  return { lat, lng };
}

export function GameMap({
  sectors,
  economies,
  presence = [],
  selectedId,
  myLocation,
  onSelect,
  onMapPlaceLocation,
  className = "",
}: Props) {
  const fc = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: sectors.map((s) => {
        const eco = economies[s.id];
        return {
          ...ringToFeature(s.id, s.name, s.ring),
          properties: {
            id: s.id,
            name: s.name,
            resources: eco?.resources ?? 0,
          },
        };
      }),
    }),
    [sectors, economies]
  );

  const presenceBySector = useMemo(() => {
    const map = new globalThis.Map<string, SectorPresence>();
    for (const p of presence) map.set(p.sectorId, p);
    return map;
  }, [presence]);

  if (!TOKEN) {
    return (
      <div className={`grid place-items-center bg-[var(--wash)] ${className}`}>
        <p className="font-mono text-xs text-[var(--ink-muted)]">No Mapbox token</p>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <MapboxMap
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
        onClick={(e: MapMouseEvent) => {
          const id = e.features?.[0]?.properties?.id;
          if (typeof id === "string") onSelect(id);
          else if (onMapPlaceLocation) {
            onMapPlaceLocation(e.lngLat.lat, e.lngLat.lng);
          }
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
                ["==", ["get", "id"], selectedId || ""],
                "#e23b2f",
                "#3d6b45",
              ] as never,
              "fill-opacity": 0.32,
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
              "text-field": [
                "format",
                ["get", "name"],
                "\n",
                ["to-string", ["get", "resources"]],
                " res",
              ],
              "text-size": 11,
              "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
              "text-offset": [0, -1.8],
            }}
            paint={{
              "text-color": "#e8ebe4",
              "text-halo-color": "#0c100e",
              "text-halo-width": 1,
            }}
          />
        </Source>

        {sectors.map((sector) => {
          const pop = presenceBySector.get(sector.id);
          if (!pop || (pop.villagers <= 0 && pop.houses <= 0)) return null;
          const { lat, lng } = sectorCenter(sector);
          const villagerCount = Math.min(pop.villagers, 3);
          return (
            <Marker
              key={`sprites-${sector.id}`}
              longitude={lng}
              latitude={lat}
              anchor="bottom"
              offset={[0, -4]}
            >
              <div className="sprite-stack">
                {pop.houses > 0 && (
                  <div className="relative">
                    <HouseSprite />
                    {pop.houses > 1 && (
                      <span className="absolute -right-1 -top-1 rounded-full bg-[var(--surface)] px-1 font-mono text-[9px] text-[var(--sand)]">
                        ×{pop.houses}
                      </span>
                    )}
                  </div>
                )}
                {Array.from({ length: villagerCount }).map((_, i) => (
                  <VillagerSprite
                    key={i}
                    digging
                    className={i > 0 ? "-ml-3" : ""}
                  />
                ))}
                {pop.villagers > 3 && (
                  <span className="mb-1 rounded-full bg-[var(--surface)]/90 px-1.5 font-mono text-[9px] text-[var(--field-bright)]">
                    +{pop.villagers - 3}
                  </span>
                )}
              </div>
            </Marker>
          );
        })}

        {myLocation && (
          <Marker
            longitude={myLocation.lng}
            latitude={myLocation.lat}
            anchor="center"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--sand)] ring-2 ring-[var(--surface)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--surface)]" />
            </span>
          </Marker>
        )}
      </MapboxMap>
    </div>
  );
}
