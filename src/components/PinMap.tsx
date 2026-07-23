"use client";

import Map, { Marker } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { ISLAMABAD_CENTER, DEFAULT_ZOOM, MAP_MAX_BOUNDS, MAP_MIN_ZOOM, MAP_MAX_ZOOM } from "@/lib/constants";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

interface PinMapProps {
  lat?: number;
  lng?: number;
  onLocationChange: (lat: number, lng: number) => void;
  compact?: boolean;
}

export function PinMap({ lat, lng, onLocationChange, compact = false }: PinMapProps) {
  const heightClass = compact ? "h-36" : "h-48";

  if (!MAPBOX_TOKEN) {
    return (
      <div className={`flex ${heightClass} items-center justify-center rounded-xl border border-line-strong bg-wash p-4 text-center`}>
        <p className="text-sm text-ink-muted">
          Add <code className="text-xs">NEXT_PUBLIC_MAPBOX_TOKEN</code> to use the map,
          or describe the area instead.
        </p>
      </div>
    );
  }

  return (
    <div className={`${heightClass} overflow-hidden rounded-xl border border-line-strong`}>
      <Map
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{
          latitude: lat ?? ISLAMABAD_CENTER.lat,
          longitude: lng ?? ISLAMABAD_CENTER.lng,
          zoom: DEFAULT_ZOOM,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="mapbox://styles/mapbox/streets-v12"
        maxBounds={MAP_MAX_BOUNDS}
        minZoom={MAP_MIN_ZOOM}
        maxZoom={MAP_MAX_ZOOM}
        onClick={(e) => onLocationChange(e.lngLat.lat, e.lngLat.lng)}
      >
        {lat != null && lng != null && (
          <Marker latitude={lat} longitude={lng} anchor="bottom" color="#D94A00" />
        )}
      </Map>
    </div>
  );
}
