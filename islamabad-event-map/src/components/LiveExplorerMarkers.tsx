"use client";

import { Marker } from "react-map-gl/mapbox";
import {
  EXPLORER_PALETTES,
  type LiveExplorer,
} from "@/hooks/useLivePresence";

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

export function LiveExplorerMarkers({
  explorers,
}: {
  explorers: LiveExplorer[];
}) {
  if (explorers.length === 0) return null;

  return (
    <>
      {explorers.map((explorer) => {
        const palette =
          EXPLORER_PALETTES[explorer.color % EXPLORER_PALETTES.length]!;
        return (
          <Marker
            key={explorer.id}
            latitude={explorer.lat!}
            longitude={explorer.lng!}
            anchor="bottom"
            style={{ zIndex: 25 }}
          >
            <div className="pointer-events-none flex -translate-y-0.5 flex-col items-center">
              <span className="mb-0.5 max-w-[7.5rem] truncate rounded-md border border-line bg-surface/95 px-1.5 py-0.5 text-[10px] font-semibold leading-tight text-ink shadow-sm backdrop-blur-sm">
                {explorer.name}
              </span>
              <HumanSprite
                shirt={palette.shirt}
                skin={palette.skin}
                hair={palette.hair}
                className="drop-shadow-sm"
              />
            </div>
          </Marker>
        );
      })}
    </>
  );
}
