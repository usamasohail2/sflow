"use client";

import { Marker } from "react-map-gl/mapbox";
import {
  EXPLORER_PALETTES,
  type LiveExplorer,
} from "@/hooks/useLivePresence";
import type { FloatingBubble } from "@/hooks/usePublicChat";

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

export function LiveExplorerMarkers({
  explorers,
  floating = [],
  selfId,
  selfPosition,
}: {
  explorers: LiveExplorer[];
  floating?: FloatingBubble[];
  selfId?: string;
  selfPosition?: { lat: number; lng: number } | null;
}) {
  const floatingByVisitor = new Map(
    floating.map((b) => [b.visitorId, b] as const)
  );

  const explorerIds = new Set(explorers.map((e) => e.id));

  // Bubbles for people not currently rendered as explorers (e.g. yourself)
  const orphanBubbles = floating.filter((b) => {
    if (explorerIds.has(b.visitorId)) return false;
    if (b.visitorId === selfId && selfPosition) return true;
    return typeof b.lat === "number" && typeof b.lng === "number";
  });

  return (
    <>
      {explorers.map((explorer) => {
        const palette =
          EXPLORER_PALETTES[explorer.color % EXPLORER_PALETTES.length]!;
        const bubble = floatingByVisitor.get(explorer.id);
        return (
          <Marker
            key={explorer.id}
            latitude={explorer.lat!}
            longitude={explorer.lng!}
            anchor="bottom"
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
        return (
          <Marker
            key={`bubble-${bubble.messageId}`}
            latitude={lat}
            longitude={lng}
            anchor="bottom"
            style={{ zIndex: 36 }}
          >
            <div className="pointer-events-none flex -translate-y-1 flex-col items-center">
              <SpeechBubble text={bubble.text} />
            </div>
          </Marker>
        );
      })}
    </>
  );
}
