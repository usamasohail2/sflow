"use client";

import { useMemo } from "react";
import Map, { Layer, Marker, Source } from "react-map-gl/mapbox";
import type { MapMouseEvent } from "react-map-gl/mapbox";
import type { FeatureCollection } from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Sector, SectorEconomy } from "@/lib/gameTypes";
import { ringToFeature } from "@/lib/geo";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

type Props = {
  sectors: Sector[];
  economies: Record<string, SectorEconomy>;
  selectedId: string | null;
  myLocation: { lat: number; lng: number } | null;
  onSelect: (id: string) => void;
  onMapPlaceLocation?: (lat: number, lng: number) => void;
  className?: string;
};

export function GameMap({
  sectors,
  economies,
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

  if (!TOKEN) {
    return (
      <div className={`grid place-items-center bg-[var(--wash)] ${className}`}>
        <p className="font-mono text-xs text-[var(--ink-muted)]">No Mapbox token</p>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <Map
        mapboxAccessToken={TOKEN}
        initialViewState={{
          longitude: 73.055,
          latitude: 33.7,
          zoom: 11.6,
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
            }}
            paint={{ "text-color": "#e8ebe4", "text-halo-color": "#0c100e", "text-halo-width": 1 }}
          />
        </Source>
        {myLocation && (
          <Marker longitude={myLocation.lng} latitude={myLocation.lat} anchor="center">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--sand)] ring-2 ring-[var(--surface)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--surface)]" />
            </span>
          </Marker>
        )}
      </Map>
    </div>
  );
}
