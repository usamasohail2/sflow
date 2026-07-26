"use client";

import { useMemo } from "react";
import { Marker } from "react-map-gl/mapbox";
import { cameraMarkerJitter } from "@/hooks/useMapPresence";
import { distMeters } from "@/lib/mapMath";
import type { PresencePeer } from "@/lib/presenceTypes";
import type { LatLng } from "@/lib/gameTypes";

const PALETTES = [
  { shirt: "#3d6b45", skin: "#f0c4a0", hair: "#2a2118" },
  { shirt: "#e23b2f", skin: "#e8b890", hair: "#4a3428" },
  { shirt: "#c4b089", skin: "#f5d0b0", hair: "#1c1c1c" },
  { shirt: "#5a9a63", skin: "#d4a574", hair: "#3b2a1a" },
  { shirt: "#a8241c", skin: "#f2c9a0", hair: "#5c4033" },
  { shirt: "#6a7264", skin: "#c68642", hair: "#111111" },
  { shirt: "#8fd48a", skin: "#f1c27d", hair: "#6b4423" },
] as const;

function paletteForId(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PALETTES[h % PALETTES.length]!;
}

function HumanSprite({
  shirt,
  skin,
  hair,
  className = "",
  width = 16,
  height = 22,
}: {
  shirt: string;
  skin: string;
  hair: string;
  className?: string;
  width?: number;
  height?: number;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 22"
      width={width}
      height={height}
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

function ViewerMapAvatar({
  peer,
  isSelf = false,
}: {
  peer: PresencePeer;
  isSelf?: boolean;
}) {
  const palette = paletteForId(peer.id);
  const label = peer.name?.trim() || (isSelf ? "You" : "Scout");
  const bubble = peer.lastMessage?.trim();

  return (
    <div
      className={`viewer-map-marker pointer-events-none flex flex-col items-center ${
        isSelf ? "viewer-map-marker--self" : ""
      }`}
      title={label}
    >
      {bubble ? (
        <div className="viewer-speech-bubble mb-1 max-w-[9.5rem]">
          <p className="line-clamp-3 break-words text-[10px] font-medium leading-snug text-[var(--ink)]">
            {bubble}
          </p>
        </div>
      ) : null}
      <span className="viewer-name-tag mb-0.5 max-w-[7.5rem] truncate px-1.5 py-px text-[9px] font-bold leading-tight text-[var(--ink)]">
        {isSelf ? `${label} (you)` : label}
      </span>
      <HumanSprite
        shirt={palette.shirt}
        skin={palette.skin}
        hair={palette.hair}
        width={16}
        height={22}
        className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]"
      />
    </div>
  );
}

type Props = {
  peers: PresencePeer[];
  self?: {
    id: string;
    name: string;
    lat: number;
    lng: number;
    bubble?: string | null;
    bubbleAt?: number | null;
  } | null;
  /** Camera center — peers farther than maxDistanceM are hidden */
  center?: LatLng | null;
  maxDistanceM?: number;
};

export function ViewerMarkers({
  peers,
  self = null,
  center = null,
  maxDistanceM,
}: Props) {
  const nearbyPeers = useMemo(() => {
    return peers.filter((peer) => {
      if (typeof peer.lat !== "number" || typeof peer.lng !== "number") {
        return false;
      }
      if (
        center &&
        typeof maxDistanceM === "number" &&
        Number.isFinite(maxDistanceM)
      ) {
        return (
          distMeters(center, { lat: peer.lat, lng: peer.lng }) <= maxDistanceM
        );
      }
      return true;
    });
  }, [peers, center, maxDistanceM]);

  return (
    <>
      {nearbyPeers.map((peer) => {
        const lat = peer.lat as number;
        const lng = peer.lng as number;
        const jitter = cameraMarkerJitter(peer.id);
        return (
          <Marker
            key={`viewer-${peer.id}`}
            latitude={lat + jitter.lat}
            longitude={lng + jitter.lng}
            anchor="bottom"
            style={{ zIndex: 12, pointerEvents: "none" }}
          >
            <ViewerMapAvatar peer={peer} />
          </Marker>
        );
      })}

      {self && (
        <Marker
          latitude={self.lat}
          longitude={self.lng}
          anchor="bottom"
          style={{ zIndex: 13, pointerEvents: "none" }}
        >
          <ViewerMapAvatar
            peer={{
              id: self.id,
              name: self.name || "You",
              lastMessage: self.bubble ?? undefined,
              lastMessageAt: self.bubbleAt ?? undefined,
            }}
            isSelf
          />
        </Marker>
      )}
    </>
  );
}
