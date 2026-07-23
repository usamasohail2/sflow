"use client";

import { useEffect, useMemo, useState } from "react";

const HEARTBEAT_MS = 15_000;
const STORAGE_KEY = "isb-map-visitor-id";
const MAX_VISIBLE = 7;

const PALETTES = [
  { shirt: "#0051FF", skin: "#f0c4a0", hair: "#2a2118" },
  { shirt: "#D94A00", skin: "#e8b890", hair: "#4a3428" },
  { shirt: "#0d9488", skin: "#f5d0b0", hair: "#1c1c1c" },
  { shirt: "#7c3aed", skin: "#d4a574", hair: "#3b2a1a" },
  { shirt: "#db2777", skin: "#f2c9a0", hair: "#5c4033" },
  { shirt: "#2563eb", skin: "#c68642", hair: "#111111" },
  { shirt: "#ea580c", skin: "#f1c27d", hair: "#6b4423" },
] as const;

function getVisitorId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "")
        : `v_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return `v_${Math.random().toString(36).slice(2)}`;
  }
}

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
}

export function ViewerTicker({ className = "" }: ViewerTickerProps) {
  const [viewers, setViewers] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const visitorId = getVisitorId();

    const beat = async () => {
      try {
        const res = await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visitorId }),
          keepalive: true,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { viewers?: number };
        if (!cancelled && typeof data.viewers === "number") {
          setViewers(Math.max(1, data.viewers));
        }
      } catch {
        // ignore transient network errors
      }
    };

    void beat();
    const id = window.setInterval(beat, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void beat();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const count = viewers ?? 1;
  const visible = Math.min(count, MAX_VISIBLE);
  const overflow = Math.max(0, count - MAX_VISIBLE);

  const people = useMemo(
    () =>
      Array.from({ length: visible }, (_, i) => ({
        id: i,
        ...PALETTES[i % PALETTES.length],
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
      className={`viewer-crowd pointer-events-none flex items-end gap-1.5 rounded-full border border-line bg-surface px-2 py-1 shadow-sm dark:bg-surface-raised ${className}`}
      aria-live="polite"
      aria-label={label}
      title={label}
    >
      <div className="relative flex h-5 items-end sm:h-6">
        {people.map((person, index) => (
          <span
            key={person.id}
            className="viewer-person absolute bottom-0 scale-[0.72] origin-bottom-left sm:scale-90"
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
        <span className="text-ink-muted">
          {count === 1 ? "viewing" : "viewing"}
        </span>
      </p>
    </div>
  );
}
