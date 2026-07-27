"use client";

import { useEffect, useRef } from "react";
import MapboxMap from "react-map-gl/mapbox";
import type { MapRef } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { INTRO_CITY_CENTER } from "@/lib/gameTypes";
import { lightPresetForIslamabad } from "@/lib/mapLight";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

/** Full-bleed Islamabad map for logged-out / landing screens. */
export function WorldBackdrop({ className = "" }: { className?: string }) {
  const mapRef = useRef<MapRef>(null);
  const driftRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (driftRef.current != null) window.clearTimeout(driftRef.current);
    };
  }, []);

  if (!TOKEN) {
    return <div className={`bg-[var(--surface)] ${className}`} aria-hidden />;
  }

  return (
    <div className={`relative overflow-hidden ${className}`} aria-hidden>
      <MapboxMap
        ref={mapRef}
        mapboxAccessToken={TOKEN}
        initialViewState={{
          longitude: INTRO_CITY_CENTER.lng,
          latitude: INTRO_CITY_CENTER.lat,
          zoom: 11.2,
          pitch: 52,
          bearing: -28,
        }}
        mapStyle="mapbox://styles/mapbox/standard"
        interactive={false}
        attributionControl={false}
        logoPosition="bottom-right"
        style={{ width: "100%", height: "100%" }}
        onLoad={(e) => {
          const m = e.target;
          try {
            m.setConfigProperty(
              "basemap",
              "lightPreset",
              lightPresetForIslamabad()
            );
            m.setConfigProperty("basemap", "show3dObjects", true);
            m.setConfigProperty("basemap", "showPlaceLabels", false);
            m.setConfigProperty("basemap", "showPointOfInterestLabels", false);
            m.setConfigProperty("basemap", "showRoadLabels", false);
            m.setConfigProperty("basemap", "showTransitLabels", false);
          } catch {
            /* older style */
          }

          // Slow orbit so the world feels alive without stealing focus
          let bearing = -28;
          const tick = () => {
            bearing += 0.035;
            try {
              m.setBearing(bearing);
            } catch {
              /* map torn down */
            }
            driftRef.current = window.setTimeout(tick, 48);
          };
          driftRef.current = window.setTimeout(tick, 800);
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[rgba(6,10,8,0.92)] via-[rgba(6,10,8,0.45)] to-[rgba(6,10,8,0.18)]" />
    </div>
  );
}
