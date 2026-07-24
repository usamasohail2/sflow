"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { Layer, Marker, Source } from "react-map-gl/mapbox";
import type { MapMouseEvent, MapRef } from "react-map-gl/mapbox";
import type { FeatureCollection } from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Sector } from "@/lib/gameTypes";
import { closeRing, ringToFeature } from "@/lib/geo";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

type Props = {
  sectors: Sector[];
  onChange: (sectors: Sector[]) => void;
  onSave: () => Promise<void>;
  saving?: boolean;
};

export function SectorEditor({ sectors, onChange, onSave, saving }: Props) {
  const mapRef = useRef<MapRef>(null);
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const fc = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: sectors.map((s) => ringToFeature(s.id, s.name, s.ring)),
    }),
    [sectors]
  );

  const draftFc = useMemo<FeatureCollection>(() => {
    if (draft.length < 2) {
      return { type: "FeatureCollection", features: [] };
    }
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: draft,
          },
        },
      ],
    };
  }, [draft]);

  const onMapClick = useCallback((e: MapMouseEvent) => {
    const { lng, lat } = e.lngLat;
    setDraft((prev) => [...prev, [lng, lat]]);
    setMessage("Keep tapping corners. Press “Close & name” when done.");
  }, []);

  const finishPolygon = () => {
    if (draft.length < 3) {
      setMessage("Need at least 3 points to close a sector.");
      return;
    }
    const name = window.prompt("Name this sector", nameDraft || "New sector");
    if (!name?.trim()) {
      setMessage("Cancelled — keep drawing or clear draft.");
      return;
    }
    const now = Date.now();
    const sector: Sector = {
      id: `sec_${Math.random().toString(36).slice(2, 10)}`,
      name: name.trim(),
      ring: closeRing(draft),
      createdAt: now,
      updatedAt: now,
    };
    onChange([...sectors, sector]);
    setDraft([]);
    setSelectedId(sector.id);
    setNameDraft(sector.name);
    setMessage(`Saved draft “${sector.name}”. Hit Save to server when ready.`);
  };

  const removeSelected = () => {
    if (!selectedId) return;
    onChange(sectors.filter((s) => s.id !== selectedId));
    setSelectedId(null);
    setNameDraft("");
  };

  const renameSelected = () => {
    if (!selectedId) return;
    const next = nameDraft.trim();
    if (!next) return;
    onChange(
      sectors.map((s) =>
        s.id === selectedId ? { ...s, name: next, updatedAt: Date.now() } : s
      )
    );
  };

  useEffect(() => {
    const s = sectors.find((x) => x.id === selectedId);
    if (s) setNameDraft(s.name);
  }, [selectedId, sectors]);

  if (!TOKEN) {
    return (
      <p className="p-6 font-mono text-sm text-[var(--ink-muted)]">
        Missing NEXT_PUBLIC_MAPBOX_TOKEN
      </p>
    );
  }

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1fr_22rem]">
      <div className="relative min-h-[55vh]">
        <Map
          ref={mapRef}
          mapboxAccessToken={TOKEN}
          initialViewState={{
            longitude: 73.055,
            latitude: 33.7,
            zoom: 11.5,
            pitch: 0,
            bearing: -28,
          }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          onClick={onMapClick}
          cursor="crosshair"
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
                "fill-opacity": 0.28,
              }}
            />
            <Layer
              id="sector-line"
              type="line"
              paint={{
                "line-color": "#e8ebe4",
                "line-width": 2,
              }}
            />
            <Layer
              id="sector-label"
              type="symbol"
              layout={{
                "text-field": ["get", "name"],
                "text-size": 12,
                "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
              }}
              paint={{ "text-color": "#e8ebe4" }}
            />
          </Source>
          <Source id="draft" type="geojson" data={draftFc}>
            <Layer
              id="draft-line"
              type="line"
              paint={{
                "line-color": "#ff5245",
                "line-width": 3,
                "line-dasharray": [2, 1],
              }}
            />
          </Source>
          {draft.map((p, i) => (
            <Marker key={`${p[0]}-${p[1]}-${i}`} longitude={p[0]} latitude={p[1]}>
              <span className="block h-2.5 w-2.5 rounded-full bg-[var(--signal-bright)] ring-2 ring-black/40" />
            </Marker>
          ))}
        </Map>
        <div className="pointer-events-none absolute left-3 top-3 max-w-sm rounded-sm border border-[var(--line)] bg-[var(--surface-raised)]/90 px-3 py-2 text-xs text-[var(--ink-muted)] backdrop-blur">
          Tap the map to place corners of a territory. Close the shape, name it,
          then Save.
        </div>
      </div>

      <aside className="flex flex-col gap-4 border-t border-[var(--line)] bg-[var(--surface-raised)] p-5 lg:border-l lg:border-t-0">
        <div>
          <h1 className="font-display text-xl text-[var(--ink)]">Sector editor</h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
            Draw · name · save
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={finishPolygon}
            className="rounded-sm bg-[var(--signal)] px-3 py-2 text-xs font-semibold text-white"
          >
            Close & name
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft([]);
              setMessage("Draft cleared.");
            }}
            className="rounded-sm border border-[var(--line)] px-3 py-2 text-xs text-[var(--ink)]"
          >
            Clear draft ({draft.length})
          </button>
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={saving}
            className="rounded-sm border border-[var(--sand)] px-3 py-2 text-xs font-semibold text-[var(--sand)]"
          >
            {saving ? "Saving…" : "Save to server"}
          </button>
        </div>

        {message && (
          <p className="text-xs leading-relaxed text-[var(--ink-muted)]">{message}</p>
        )}

        <div>
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Territories ({sectors.length})
          </h2>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {sectors.length === 0 && (
              <li className="text-xs text-[var(--ink-faint)]">None yet — draw one.</li>
            )}
            {sectors.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={`w-full rounded-sm px-2 py-1.5 text-left text-sm ${
                    selectedId === s.id
                      ? "bg-[var(--signal)]/20 text-[var(--ink)]"
                      : "text-[var(--ink-muted)] hover:bg-[var(--wash)]"
                  }`}
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {selectedId && (
          <div className="space-y-2 border-t border-[var(--line)] pt-4">
            <label className="block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
              Rename
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                className="mt-1 w-full rounded-sm border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--ink)] outline-none"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={renameSelected}
                className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs"
              >
                Apply name
              </button>
              <button
                type="button"
                onClick={removeSelected}
                className="rounded-sm border border-[var(--signal)] px-3 py-1.5 text-xs text-[var(--signal-bright)]"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
