"use client";

import { useEffect, useRef, useState } from "react";
import { Marker, useMap } from "react-map-gl/mapbox";
import type { MapRef } from "react-map-gl/mapbox";
import {
  EXPLORER_PALETTES,
  type LiveExplorer,
} from "@/hooks/useLivePresence";
import type { FloatingBubble } from "@/hooks/usePublicChat";
import { altitudeMarkerOffset } from "@/lib/mapAltitude";

/** Smoothing time constant — lower = snappier, higher = silkier */
const SMOOTH_MS = 160;
/** Jump instantly if the gap is huge (teleport / first spawn) */
const SNAP_DEG = 0.08;
const SNAP_ALT_M = 400;

function HumanSprite({
  shirt,
  skin,
  hair,
  className = "",
}: {
  shirt: string;
  skin: string;
  hair: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 22"
      width="22"
      height="30"
      aria-hidden
    >
      <rect x="4" y="1" width="8" height="3" fill={hair} />
      <rect x="3" y="3" width="2" height="2" fill={hair} />
      <rect x="11" y="3" width="2" height="2" fill={hair} />
      <rect x="4" y="3" width="8" height="7" fill={skin} />
      <rect x="5" y="5" width="2" height="2" fill="#1a1a1a" />
      <rect x="9" y="5" width="2" height="2" fill="#1a1a1a" />
      <rect x="3" y="10" width="10" height="7" fill={shirt} />
      <rect x="1" y="11" width="2" height="5" fill={skin} />
      <rect x="13" y="11" width="2" height="5" fill={skin} />
      <rect x="4" y="17" width="3" height="4" fill="#2a2a2a" />
      <rect x="9" y="17" width="3" height="4" fill="#2a2a2a" />
    </svg>
  );
}

function SpeechBubble({ text }: { text: string }) {
  return (
    <div className="chat-float-bubble relative mb-1 max-w-[10rem] rounded-2xl rounded-bl-md border border-line bg-surface px-2 py-1 text-center text-[11px] font-semibold leading-snug text-ink shadow-md">
      <span className="line-clamp-3 break-words">{text}</span>
      <span
        aria-hidden
        className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r border-line bg-surface"
      />
    </div>
  );
}

interface SmoothExplorer {
  id: string;
  name: string;
  color: number;
  lat: number;
  lng: number;
  alt: number;
  targetLat: number;
  targetLng: number;
  targetAlt: number;
}

function useSmoothedExplorers(explorers: LiveExplorer[]): SmoothExplorer[] {
  const [smooth, setSmooth] = useState<SmoothExplorer[]>([]);
  const stateRef = useRef<Map<string, SmoothExplorer>>(new Map());
  const lastTs = useRef<number>(0);

  useEffect(() => {
    const next = new Map(stateRef.current);
    const liveIds = new Set<string>();

    for (const explorer of explorers) {
      if (explorer.lat == null || explorer.lng == null) continue;
      liveIds.add(explorer.id);
      const alt = explorer.alt ?? 0;
      const prev = next.get(explorer.id);
      if (!prev) {
        next.set(explorer.id, {
          id: explorer.id,
          name: explorer.name,
          color: explorer.color,
          lat: explorer.lat,
          lng: explorer.lng,
          alt,
          targetLat: explorer.lat,
          targetLng: explorer.lng,
          targetAlt: alt,
        });
      } else {
        prev.name = explorer.name;
        prev.color = explorer.color;
        prev.targetLat = explorer.lat;
        prev.targetLng = explorer.lng;
        prev.targetAlt = alt;
        const dLat = Math.abs(prev.lat - explorer.lat);
        const dLng = Math.abs(prev.lng - explorer.lng);
        const dAlt = Math.abs(prev.alt - alt);
        if (dLat > SNAP_DEG || dLng > SNAP_DEG || dAlt > SNAP_ALT_M) {
          prev.lat = explorer.lat;
          prev.lng = explorer.lng;
          prev.alt = alt;
        }
      }
    }

    for (const id of Array.from(next.keys())) {
      if (!liveIds.has(id)) next.delete(id);
    }

    stateRef.current = next;
    setSmooth(Array.from(next.values()).map((e) => ({ ...e })));
  }, [explorers]);

  useEffect(() => {
    let raf = 0;
    lastTs.current = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(64, now - lastTs.current);
      lastTs.current = now;
      const alpha = 1 - Math.exp(-dt / SMOOTH_MS);
      let moved = false;

      stateRef.current.forEach((e) => {
        const dLat = e.targetLat - e.lat;
        const dLng = e.targetLng - e.lng;
        const dAlt = e.targetAlt - e.alt;
        if (
          Math.abs(dLat) < 1e-7 &&
          Math.abs(dLng) < 1e-7 &&
          Math.abs(dAlt) < 0.05
        ) {
          if (
            e.lat !== e.targetLat ||
            e.lng !== e.targetLng ||
            e.alt !== e.targetAlt
          ) {
            e.lat = e.targetLat;
            e.lng = e.targetLng;
            e.alt = e.targetAlt;
            moved = true;
          }
          return;
        }
        e.lat += dLat * alpha;
        e.lng += dLng * alpha;
        e.alt += dAlt * alpha;
        moved = true;
      });

      if (moved) {
        setSmooth(Array.from(stateRef.current.values()).map((e) => ({ ...e })));
      }
      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return smooth;
}

function useAltitudeOffsets(
  explorers: SmoothExplorer[]
): Map<string, [number, number]> {
  const mapRef = useMap();
  const [offsets, setOffsets] = useState<Map<string, [number, number]>>(
    () => new Map()
  );

  useEffect(() => {
    const mapbox = mapRef.current as MapRef | undefined;
    const map = mapbox?.getMap?.();
    if (!map) return;

    let raf = 0;
    const update = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        const next = new Map<string, [number, number]>();
        for (const e of explorers) {
          next.set(e.id, altitudeMarkerOffset(map, e.lng, e.lat, e.alt));
        }
        setOffsets(next);
      });
    };

    update();
    map.on("render", update);
    return () => {
      window.cancelAnimationFrame(raf);
      map.off("render", update);
    };
  }, [explorers, mapRef]);

  return offsets;
}

export function LiveExplorerMarkers({
  explorers,
  floating = [],
  selfId,
  selfPosition,
}: {
  explorers: LiveExplorer[];
  floating?: FloatingBubble[];
  selfId?: string;
  selfPosition?: { lat: number; lng: number; alt?: number } | null;
}) {
  const smoothExplorers = useSmoothedExplorers(explorers);
  const altitudeOffsets = useAltitudeOffsets(smoothExplorers);
  const floatingByVisitor = new Map(
    floating.map((b) => [b.visitorId, b] as const)
  );

  const explorerIds = new Set(smoothExplorers.map((e) => e.id));

  const orphanBubbles = floating.filter((b) => {
    if (explorerIds.has(b.visitorId)) return false;
    if (b.visitorId === selfId && selfPosition) return true;
    return typeof b.lat === "number" && typeof b.lng === "number";
  });

  return (
    <>
      {smoothExplorers.map((explorer) => {
        const palette =
          EXPLORER_PALETTES[explorer.color % EXPLORER_PALETTES.length]!;
        const bubble = floatingByVisitor.get(explorer.id);
        const offset = altitudeOffsets.get(explorer.id) ?? [0, 0];
        return (
          <Marker
            key={explorer.id}
            latitude={explorer.lat}
            longitude={explorer.lng}
            anchor="bottom"
            offset={offset}
            style={{ zIndex: bubble ? 35 : 25 }}
          >
            <div className="pointer-events-none flex -translate-y-0.5 flex-col items-center">
              {bubble && <SpeechBubble text={bubble.text} />}
              <span className="mb-0.5 max-w-[7.5rem] truncate rounded-md border border-line bg-surface/95 px-1.5 py-0.5 text-[10px] font-semibold leading-tight text-ink shadow-sm backdrop-blur-sm">
                {explorer.name}
              </span>
              <HumanSprite
                shirt={palette.shirt}
                skin={palette.skin}
                hair={palette.hair}
                className="drop-shadow-sm"
              />
              {/* Soft shadow on the ground (offset cancels marker AGL lift) */}
              {explorer.alt > 5 && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-1/2 top-full mt-0.5 h-1.5 w-4 -translate-x-1/2 rounded-full bg-black/25 blur-[1px]"
                  style={{
                    transform: `translate(-50%, ${-offset[1]}px) scale(${Math.min(1.4, 0.55 + explorer.alt / 1200)})`,
                    opacity: Math.min(0.4, 0.1 + explorer.alt / 2500),
                  }}
                />
              )}
            </div>
          </Marker>
        );
      })}

      {orphanBubbles.map((bubble) => {
        const lat =
          bubble.visitorId === selfId && selfPosition
            ? selfPosition.lat
            : bubble.lat;
        const lng =
          bubble.visitorId === selfId && selfPosition
            ? selfPosition.lng
            : bubble.lng;
        const alt =
          bubble.visitorId === selfId && selfPosition
            ? selfPosition.alt ?? bubble.alt ?? 0
            : bubble.alt ?? 0;
        return (
          <OrphanAltitudeBubble
            key={`bubble-${bubble.messageId}`}
            latitude={lat}
            longitude={lng}
            altitude={alt}
            text={bubble.text}
          />
        );
      })}
    </>
  );
}

function OrphanAltitudeBubble({
  latitude,
  longitude,
  altitude,
  text,
}: {
  latitude: number;
  longitude: number;
  altitude: number;
  text: string;
}) {
  const mapRef = useMap();
  const [offset, setOffset] = useState<[number, number]>([0, 0]);

  useEffect(() => {
    const mapbox = mapRef.current as MapRef | undefined;
    const map = mapbox?.getMap?.();
    if (!map) return;

    let raf = 0;
    const update = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        setOffset(altitudeMarkerOffset(map, longitude, latitude, altitude));
      });
    };
    update();
    map.on("render", update);
    return () => {
      window.cancelAnimationFrame(raf);
      map.off("render", update);
    };
  }, [altitude, latitude, longitude, mapRef]);

  return (
    <Marker
      latitude={latitude}
      longitude={longitude}
      anchor="bottom"
      offset={offset}
      style={{ zIndex: 36 }}
    >
      <div className="pointer-events-none flex -translate-y-1 flex-col items-center">
        <SpeechBubble text={text} />
      </div>
    </Marker>
  );
}
