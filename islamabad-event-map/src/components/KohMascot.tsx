"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { KohAboutModal } from "./KohAboutModal";
import { useTheme } from "./ThemeProvider";

export type KohMood = "idle" | "wave" | "look" | "cheer" | "run" | "lost";

interface KohMascotProps {
  size?: number;
  mood?: KohMood;
  className?: string;
  interactive?: boolean;
  label?: string;
  onClick?: () => void;
}

/**
 * Koh — pixel explorer sprite (Calciumtrice Animated Warrior, CC BY 3.0).
 * Sheet: 10 frames × 5 rows (idle, gesture, walk, attack, death), 96px cells.
 */
export function KohMascot({
  size = 48,
  mood = "idle",
  className = "",
  interactive = false,
  label,
  onClick,
}: KohMascotProps) {
  const [localMood, setLocalMood] = useState<KohMood>(mood);

  useEffect(() => {
    setLocalMood(mood);
  }, [mood]);

  const handleClick = () => {
    if (!interactive) return;
    setLocalMood("wave");
    window.setTimeout(() => setLocalMood("idle"), 1200);
    onClick?.();
  };

  const animClass =
    localMood === "wave"
      ? "koh-anim-wave"
      : localMood === "run"
        ? "koh-anim-run"
        : localMood === "cheer"
          ? "koh-anim-cheer"
          : localMood === "lost"
            ? "koh-anim-lost"
            : localMood === "look"
              ? "koh-anim-look"
              : "koh-anim-idle";

  const sprite = (
    <span
      className={`koh-pixel ${animClass}`}
      style={
        {
          width: size,
          height: size,
          ["--koh-size"]: `${size}px`,
        } as CSSProperties
      }
      aria-hidden
    />
  );

  const wrapClass = `inline-flex shrink-0 items-center justify-center ${className}`;

  if (interactive) {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={label ?? "Koh, the map explorer"}
        className={`${wrapClass} cursor-pointer`}
        style={{ width: size, height: size }}
      >
        {sprite}
      </button>
    );
  }

  return (
    <span
      className={wrapClass}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {sprite}
    </span>
  );
}

interface FloatingSpritesProps {
  className?: string;
}

function LeafIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" className={className} aria-hidden>
      <path
        d="M4 14c6-1 11-6 14-12-7 1-13 6-14 12 1 .4 0 .7 0 0Z"
        fill="#2d8a4e"
      />
      <path
        d="M5 13c3-2 7-5 10-8"
        fill="none"
        stroke="#1f5c36"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}

function BirdIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 16" width="20" height="12" className={className} aria-hidden>
      <path
        d="M2 10c4-1 7-4 9-7 1 3 3 5 7 6-3 1-5 3-6 5-2-2-5-3-10-4Z"
        fill="#4a5568"
      />
      <circle cx="20" cy="7.5" r="1" fill="#f6d365" />
    </svg>
  );
}

function PixelGhost({
  size = 40,
  variant = "a",
}: {
  size?: number;
  variant?: "a" | "b" | "c";
}) {
  return (
    <span
      className={`spooky-ghost spooky-ghost-${variant}`}
      style={
        {
          width: size,
          height: size,
          ["--spook-size"]: `${size}px`,
        } as CSSProperties
      }
    />
  );
}

function PixelSkeleton({ size = 48 }: { size?: number }) {
  return (
    <span
      className="spooky-skel"
      style={
        {
          width: size,
          height: Math.round(size * (48 / 36)),
          ["--skel-w"]: `${size}px`,
          ["--skel-h"]: `${Math.round(size * (48 / 36))}px`,
        } as CSSProperties
      }
    />
  );
}

export function FloatingSprites({ className = "" }: FloatingSpritesProps) {
  const { theme } = useTheme();
  const spooky = theme === "dark";

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden
    >
      {spooky && (
        <>
          <span className="spooky-float spooky-float-a">
            <PixelGhost size={40} variant="a" />
          </span>
          <span className="spooky-float spooky-float-b">
            <PixelGhost size={30} variant="b" />
          </span>
          <span className="spooky-float spooky-float-c">
            <PixelGhost size={36} variant="c" />
          </span>
          <span className="spooky-float spooky-float-d">
            <PixelGhost size={26} variant="a" />
          </span>
          <span className="spooky-float spooky-float-e">
            <PixelGhost size={32} variant="b" />
          </span>
          <span className="spooky-march spooky-march-a">
            <PixelSkeleton size={40} />
          </span>
          <span className="spooky-march spooky-march-b">
            <PixelSkeleton size={32} />
          </span>
          <span className="spooky-march spooky-march-c">
            <PixelSkeleton size={28} />
          </span>
          <span className="spooky-march spooky-march-d">
            <PixelSkeleton size={36} />
          </span>
          <span className="spooky-mist spooky-mist-a" />
          <span className="spooky-mist spooky-mist-b" />
          <span className="spooky-mist spooky-mist-c" />
        </>
      )}

      {/* Soft atmosphere (always) */}
      <span className="sprite-leaf sprite-leaf-a">
        <LeafIcon />
      </span>
      <span className="sprite-bird">
        <BirdIcon />
      </span>
      <span className="sprite-spark sprite-spark-a" />
      <span className="sprite-spark sprite-spark-b" />
    </div>
  );
}

const KOH_TIPS_LIGHT = [
  "I know a spot.",
  "Tap a pin — I’ll zoom you in!",
  "Trust me. I’ve walked these sectors.",
  "Suggest a spot you love.",
  "Trail 5 is calling…",
  "Hungry? The map knows.",
  "Not lost. Just exploring.",
  "F-6 or F-7? Wrong question. Both.",
  "Got a secret café? Drop a pin.",
  "Good spots don’t find themselves.",
  "Margalla’s that way. Always.",
  "One more pin. For science.",
];

const KOH_TIPS_DARK = [
  ...KOH_TIPS_LIGHT,
  "Psst… Margalla gets spooky after dark.",
  "The ghosts know the good trails.",
  "Night mode unlocked. Be cool.",
];

interface KohCompanionProps {
  className?: string;
}

export function KohCompanion({ className = "" }: KohCompanionProps) {
  const { theme } = useTheme();
  const tips = theme === "dark" ? KOH_TIPS_DARK : KOH_TIPS_LIGHT;
  const [tip, setTip] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    setTip(0);
  }, [theme]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTip((t) => (t + 1) % tips.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [tips.length]);

  return (
    <>
      <div
        className={`pointer-events-auto absolute bottom-4 left-4 z-10 flex max-w-[220px] items-end gap-2 ${className}`}
      >
        <KohMascot
          size={64}
          interactive
          mood="idle"
          label="About Islamabad Explore — talk to Koh"
          onClick={() => setAboutOpen(true)}
        />
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          className="koh-bubble mb-2 rounded-2xl rounded-bl-md border border-line bg-raised/95 px-3 py-2 text-left text-[12px] font-medium leading-snug text-ink shadow-md backdrop-blur-sm transition hover:border-ink-faint"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#2d8a4e]">
            Koh
          </p>
          <p key={tip} className="koh-tip-fade mt-0.5">
            {tips[tip]}
          </p>
          <p className="mt-1 text-[10px] text-ink-faint">Tap me for the lore</p>
        </button>
      </div>
      <KohAboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  );
}
