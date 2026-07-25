"use client";

import type { CSSProperties } from "react";
import type { GemType } from "@/lib/gameTypes";
import { GEM_META } from "@/lib/gameTypes";

const PALETTE: Record<
  GemType,
  { a: string; b: string; c: string; glow: string }
> = {
  wood: {
    a: "#a9743f",
    b: "#6b4228",
    c: "#d9b07c",
    glow: "rgba(169,116,63,0.5)",
  },
  stone: {
    a: "#9aa392",
    b: "#5d6a63",
    c: "#cdd4c5",
    glow: "rgba(154,163,146,0.5)",
  },
  amber: {
    a: "#f6c453",
    b: "#e89a1a",
    c: "#fff1c2",
    glow: "rgba(246,196,83,0.65)",
  },
  emerald: {
    a: "#3dff9a",
    b: "#0d9b5c",
    c: "#c8ffe0",
    glow: "rgba(61,255,154,0.55)",
  },
  sapphire: {
    a: "#5aa8ff",
    b: "#1a4fd6",
    c: "#d6e9ff",
    glow: "rgba(90,168,255,0.6)",
  },
  ruby: {
    a: "#ff5a7a",
    b: "#c4183c",
    c: "#ffd0d8",
    glow: "rgba(255,90,122,0.6)",
  },
  diamond: {
    a: "#e8f4ff",
    b: "#7ec8ff",
    c: "#ffffff",
    glow: "rgba(180,230,255,0.75)",
  },
};

type Props = {
  gem: GemType;
  size?: number;
  depleted?: boolean;
  pulse?: boolean;
  className?: string;
  title?: string;
  onClick?: () => void;
};

/** Faceted crystal marker for map resources */
export function ResourceGem({
  gem,
  size = 36,
  depleted = false,
  pulse = false,
  className = "",
  title,
  onClick,
}: Props) {
  const p = PALETTE[gem];
  const label = title || GEM_META[gem].label;
  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`resource-gem ${pulse ? "is-pulse" : ""} ${
        depleted ? "is-depleted" : ""
      } ${className}`}
      style={
        {
          width: size,
          height: size,
          ["--gem-glow" as string]: p.glow,
        } as CSSProperties
      }
      title={label}
      aria-label={label}
    >
      <svg viewBox="0 0 40 44" width={size} height={size * 1.1} role="img">
        <defs>
          <linearGradient id={`g-${gem}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={p.c} />
            <stop offset="45%" stopColor={p.a} />
            <stop offset="100%" stopColor={p.b} />
          </linearGradient>
          <filter id={`glow-${gem}`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* ground shimmer */}
        <ellipse cx="20" cy="40" rx="9" ry="2.2" fill={p.glow} opacity="0.55" />
        {/* crystal body */}
        <g filter={`url(#glow-${gem})`} className="gem-body">
          <path
            d="M20 4 L32 16 L26 36 L14 36 L8 16 Z"
            fill={`url(#g-${gem})`}
            stroke={p.c}
            strokeWidth="0.7"
            opacity={depleted ? 0.35 : 1}
          />
          {/* facet lines */}
          <path
            d="M20 4 L20 36 M20 4 L8 16 M20 4 L32 16 M14 36 L20 16 L26 36"
            fill="none"
            stroke={p.c}
            strokeWidth="0.55"
            opacity="0.55"
          />
          {/* shine */}
          <path
            d="M15 12 L18 9 L19.5 14 Z"
            fill="#fff"
            opacity={depleted ? 0.15 : 0.7}
          />
        </g>
        {/* sparkles */}
        {!depleted && (
          <g className="gem-sparkles" fill={p.c}>
            <circle className="s1" cx="30" cy="10" r="1.2" />
            <circle className="s2" cx="10" cy="14" r="0.9" />
            <circle className="s3" cx="28" cy="28" r="0.8" />
          </g>
        )}
      </svg>
    </Tag>
  );
}
