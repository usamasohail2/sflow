"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Map, { Layer, Source } from "react-map-gl/mapbox";
import type { MapMouseEvent, MapRef } from "react-map-gl/mapbox";
import type { FeatureCollection } from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  islamabadSectors,
  sectorWallsCollection,
  SECTOR_CENTER,
} from "@/lib/sectors";
import wallsJson from "@/data/islamabad-sector-walls.json";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

const wallsData = wallsJson as FeatureCollection;

const FILL_COLOR = [
  "match",
  ["get", "letter"],
  "E",
  "#5a9a63",
  "F",
  "#c4b089",
  "G",
  "#e23b2f",
  "H",
  "#6a8caf",
  "I",
  "#b07d4f",
  "#9aa392",
] as const;

type Props = {
  selectedId: string | null;
  onSelect: (sectorId: string) => void;
  className?: string;
};

function sectorFromEvent(e: MapMouseEvent): string | null {
  const f = e.features?.[0];
  if (!f?.properties) return null;
  const sector = f.properties.sector;
  if (typeof sector === "string" && sector) return sector;
  const id = f.properties.id;
  if (typeof id !== "string" || !id) return null;
  if (id.includes("-wall-")) return id.split("-wall-")[0] ?? null;
  return id;
}

export function SectorMap({ selectedId, onSelect, className = "" }: Props) {
  const mapRef = useRef<MapRef>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const wallsFc = useMemo(() => sectorWallsCollection(), []);

  const onClick = useCallback(
    (e: MapMouseEvent) => {
      const sectorId = sectorFromEvent(e);
      if (sectorId) onSelect(sectorId);
    },
    [onSelect]
  );

  const onMove = useCallback((e: MapMouseEvent) => {
    const sector = sectorFromEvent(e);
    setHoverId(sector);
    if (mapRef.current) {
      mapRef.current.getCanvas().style.cursor = sector ? "pointer" : "";
    }
  }, []);

  if (!TOKEN) {
    return (
      <div
        className={`flex items-center justify-center border border-[var(--line)] bg-[var(--wash)] ${className}`}
      >
        <p className="max-w-xs px-4 text-center font-mono text-[11px] text-[var(--ink-muted)]">
          Add <code className="text-[var(--sand)]">NEXT_PUBLIC_MAPBOX_TOKEN</code>{" "}
          to show sector walls on the map.
        </p>
      </div>
    );
  }

  const active = selectedId || hoverId;

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <Map
        ref={mapRef}
        mapboxAccessToken={TOKEN}
        initialViewState={{
          longitude: SECTOR_CENTER.lng,
          latitude: SECTOR_CENTER.lat,
          zoom: SECTOR_CENTER.zoom,
          pitch: 52,
          bearing: -28,
        }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        interactiveLayerIds={["sector-fills", "sector-walls-3d"]}
        onClick={onClick}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverId(null)}
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
      >
        <Source id="sectors" type="geojson" data={islamabadSectors}>
          <Layer
            id="sector-fills"
            type="fill"
            paint={{
              "fill-color": FILL_COLOR as never,
              "fill-opacity": [
                "case",
                ["==", ["get", "id"], active || ""],
                0.38,
                0.16,
              ] as never,
            }}
          />
          <Layer
            id="sector-outline-glow"
            type="line"
            paint={{
              "line-color": [
                "case",
                ["==", ["get", "id"], active || ""],
                "#e8ebe4",
                "#3d4a3f",
              ] as never,
              "line-width": [
                "case",
                ["==", ["get", "id"], active || ""],
                2.5,
                1,
              ] as never,
              "line-opacity": 0.9,
            }}
          />
        </Source>

        <Source id="sector-walls" type="geojson" data={wallsData}>
          <Layer
            id="sector-walls-3d"
            type="fill-extrusion"
            paint={{
              "fill-extrusion-color": [
                "case",
                ["==", ["get", "sector"], active || ""],
                "#ff5245",
                [
                  "match",
                  ["get", "letter"],
                  "E",
                  "#7fbf88",
                  "F",
                  "#d4c49a",
                  "G",
                  "#c73a30",
                  "H",
                  "#7f9fbf",
                  "I",
                  "#c49264",
                  "#8a9284",
                ],
              ] as never,
              "fill-extrusion-height": [
                "case",
                ["==", ["get", "sector"], active || ""],
                70,
                ["get", "height"],
              ] as never,
              "fill-extrusion-base": 0,
              "fill-extrusion-opacity": 0.92,
            }}
          />
        </Source>

        <Source id="sector-wall-lines" type="geojson" data={wallsFc}>
          <Layer
            id="sector-wall-lines"
            type="line"
            paint={{
              "line-color": "#0c100e",
              "line-width": 3,
              "line-opacity": 0.55,
            }}
          />
        </Source>
      </Map>

      <div className="pointer-events-none absolute left-3 top-3 rounded-sm border border-[var(--line)] bg-[var(--surface-raised)]/85 px-3 py-2 backdrop-blur-sm">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--sand)]">
          Sector walls
        </p>
        <p className="mt-1 font-display text-lg text-[var(--ink)]">
          {active ?? "Select a sector"}
        </p>
      </div>
    </div>
  );
}
