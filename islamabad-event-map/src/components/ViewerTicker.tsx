"use client";

import { useMemo } from "react";
import { EXPLORER_PALETTES } from "@/hooks/useLivePresence";

const MAX_VISIBLE = 7;

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
      width="18"
      height="24"
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

interface ViewerTickerProps {
  className?: string;
  viewers?: number | null;
  explorerCount?: number;
  showExplorers?: boolean;
  onToggleExplorers?: (show: boolean) => void;
}

export function ViewerTicker({
  className = "",
  viewers = null,
  explorerCount = 0,
  showExplorers = true,
  onToggleExplorers,
}: ViewerTickerProps) {
  const count = viewers ?? 1;
  const visible = Math.min(count, MAX_VISIBLE);
  const overflow = Math.max(0, count - MAX_VISIBLE);

  const people = useMemo(
    () =>
      Array.from({ length: visible }, (_, i) => ({
        id: i,
        ...EXPLORER_PALETTES[i % EXPLORER_PALETTES.length],
      })),
    [visible]
  );

  const label =
    viewers == null
      ? "People exploring the map"
      : count === 1
        ? "1 person viewing the map"
        : `${count} people viewing the map`;

  return (
    <div
      className={`viewer-crowd pointer-events-auto flex items-end gap-1.5 rounded-full border border-line bg-surface px-2 py-1 shadow-sm dark:bg-surface-raised ${className}`}
      aria-live="polite"
      aria-label={label}
      title={label}
    >
      <div className="relative flex h-5 items-end sm:h-6">
        {people.map((person, index) => (
          <span
            key={person.id}
            className="viewer-person absolute bottom-0 origin-bottom-left scale-[0.72] sm:scale-90"
            style={{
              left: `${index * 8}px`,
              zIndex: index + 1,
              animationDelay: `${index * 80}ms`,
            }}
          >
            <HumanSprite
              shirt={person.shirt}
              skin={person.skin}
              hair={person.hair}
            />
          </span>
        ))}
        <span
          className="block"
          style={{ width: `${Math.max(14, (visible - 1) * 8 + 14)}px` }}
          aria-hidden
        />
      </div>

      {overflow > 0 && (
        <span className="mb-0.5 rounded-full bg-wash px-1 py-0.5 text-[9px] font-bold tabular-nums text-ink-muted">
          +{overflow}
        </span>
      )}

      <p className="mb-0.5 whitespace-nowrap text-[10px] font-semibold text-ink sm:text-[11px]">
        <span className="tabular-nums text-[var(--blue)]">{count}</span>{" "}
        <span className="text-ink-muted">viewing</span>
      </p>

      {onToggleExplorers && (
        <button
          type="button"
          onClick={() => onToggleExplorers(!showExplorers)}
          aria-pressed={showExplorers}
          title={
            showExplorers
              ? "Hide other explorers on the map"
              : "Show other explorers on the map"
          }
          className={`mb-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-bold transition ${
            showExplorers
              ? "border-[var(--blue)] bg-[color-mix(in_srgb,var(--blue)_14%,transparent)] text-[var(--blue)]"
              : "border-line bg-wash text-ink-muted"
          }`}
        >
          {showExplorers
            ? explorerCount > 0
              ? `Live · ${explorerCount}`
              : "Live"
            : "Live off"}
        </button>
      )}
    </div>
  );
}
