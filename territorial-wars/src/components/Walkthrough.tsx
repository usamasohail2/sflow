"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

/** Bumped so returning players see the new guided settle tour */
export const WALKTHROUGH_KEY = "itw_walkthrough_v2";

export type GuidePhase =
  | "welcome"
  | "gps"
  | "settle-btn"
  | "place-house"
  | "place-villager"
  | "live"
  | "tips-gather"
  | "tips-build"
  | "tips-raid"
  | "tips-invite";

export type GuideContext = {
  claimed: boolean;
  gpsReady: boolean;
  /** Current placement kind, if any */
  placingKind: string | null;
  sectorName: string | null;
};

type TipDef = {
  title: string;
  body: string;
  /** data-guide id to spotlight; null = centered modal */
  target: string | null;
  /** Blocking overlay (welcome / tips). Interactive steps leave the map clickable. */
  blocking: boolean;
  cta?: string;
};

const TIPS: Record<GuidePhase, TipDef> = {
  welcome: {
    title: "Let’s build your village",
    body: "I’ll walk you through settling: confirm where you are, plant a house, then place a villager who gathers gold for you.",
    target: null,
    blocking: true,
    cta: "Start setup",
  },
  gps: {
    title: "Confirm your location",
    body: "Tap the blinking button to lock GPS in this sector. (Demo bypass works if you’re testing remotely.)",
    target: "guide-gps",
    blocking: false,
  },
  "settle-btn": {
    title: "Start settling",
    body: "Location locked. Tap the blinking Settle button — next you’ll plant your house on the map.",
    target: "guide-settle",
    blocking: false,
  },
  "place-house": {
    title: "Plant your house",
    body: "Tap inside the sector walls. A green ring means clear ground. Place it where you want your village center.",
    target: "guide-place-banner",
    blocking: false,
  },
  "place-villager": {
    title: "Place your villager",
    body: "Tap nearby to station your villager. They walk out, dig, and bring gold home on a loop.",
    target: "guide-place-banner",
    blocking: false,
  },
  live: {
    title: "Village is live",
    body: "Your walls glow blue. Villagers gather automatically — spend gold on buildings and rockets next.",
    target: null,
    blocking: true,
    cta: "What’s next?",
  },
  "tips-gather": {
    title: "Gold comes to you",
    body: "Watch your villager farm. Zoom into the streets and roam to spawn rare finds you can tap to collect.",
    target: null,
    blocking: true,
    cta: "Next",
  },
  "tips-build": {
    title: "Build & arm",
    body: "Use Build to place mills and turrets. Stock rockets in Arsenal — you pick how many to fire on a raid.",
    target: null,
    blocking: true,
    cta: "Next",
  },
  "tips-raid": {
    title: "Raid rivals",
    body: "Tap an enemy house or building in another sector to attack. Same-sector settlers are allies (green) — you can’t hit them.",
    target: null,
    blocking: true,
    cta: "Next",
  },
  "tips-invite": {
    title: "Invite for villagers",
    body: "Menu → Invite friends. Every friend who joins with your link gives you +1 villager — permanent gather power.",
    target: null,
    blocking: true,
    cta: "Got it — play",
  },
};

const TIP_ORDER: GuidePhase[] = [
  "tips-gather",
  "tips-build",
  "tips-raid",
  "tips-invite",
];

type Props = {
  open: boolean;
  onClose: () => void;
  ctx: GuideContext;
};

function markDone() {
  try {
    window.localStorage.setItem(WALKTHROUGH_KEY, "1");
  } catch {
    /* ignore */
  }
}

function useTargetRect(
  target: string | null,
  open: boolean,
  tick: number
): { top: number; left: number; width: number; height: number } | null {
  const [rect, setRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open || !target) {
      setRect(null);
      return;
    }

    const measure = () => {
      const root = document.querySelector("[data-guide-root]") as HTMLElement | null;
      const el = document.querySelector(
        `[data-guide="${target}"]`
      ) as HTMLElement | null;
      if (!root || !el) {
        setRect(null);
        return;
      }
      const rr = root.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      setRect({
        top: er.top - rr.top - 8,
        left: er.left - rr.left - 8,
        width: er.width + 16,
        height: er.height + 16,
      });
    };

    measure();
    const id = window.setInterval(measure, 180);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", measure);
    };
  }, [target, open, tick]);

  return rect;
}

export function Walkthrough({ open, onClose, ctx }: Props) {
  const [phase, setPhase] = useState<GuidePhase>("welcome");
  const [tick, setTick] = useState(0);
  const startedRef = useRef(false);

  // Fresh run each time the tour opens
  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    setPhase(ctx.claimed ? "tips-gather" : "welcome");
    setTick((t) => t + 1);
  }, [open, ctx.claimed]);

  // Auto-advance settle steps from live game state
  useEffect(() => {
    if (!open) return;

    if (ctx.claimed) {
      if (
        phase === "gps" ||
        phase === "settle-btn" ||
        phase === "place-house" ||
        phase === "place-villager"
      ) {
        setPhase("live");
      }
      return;
    }

    if (phase === "gps" && ctx.gpsReady) {
      setPhase("settle-btn");
      setTick((t) => t + 1);
      return;
    }
    if (phase === "settle-btn" && ctx.placingKind === "house") {
      setPhase("place-house");
      setTick((t) => t + 1);
      return;
    }
    if (phase === "place-house" && ctx.placingKind === "villager") {
      setPhase("place-villager");
      setTick((t) => t + 1);
      return;
    }
    // If they jump ahead (e.g. already placing)
    if (
      (phase === "welcome" || phase === "gps" || phase === "settle-btn") &&
      ctx.placingKind === "house"
    ) {
      setPhase("place-house");
    }
    if (
      (phase === "welcome" ||
        phase === "gps" ||
        phase === "settle-btn" ||
        phase === "place-house") &&
      ctx.placingKind === "villager"
    ) {
      setPhase("place-villager");
    }
  }, [open, ctx.claimed, ctx.gpsReady, ctx.placingKind, phase]);

  // Blink class on the live target element
  useEffect(() => {
    if (!open) return;
    const tip = TIPS[phase];
    const id = tip.target;
    if (!id) return;
    const el = document.querySelector(`[data-guide="${id}"]`);
    if (!el) return;
    el.classList.add("is-guide-hot");
    return () => el.classList.remove("is-guide-hot");
  }, [open, phase, tick, ctx.gpsReady, ctx.placingKind]);

  const tip = TIPS[phase];
  const rect = useTargetRect(tip.target, open, tick);

  if (!open) return null;

  const finish = () => {
    markDone();
    onClose();
  };

  const advance = () => {
    if (phase === "welcome") {
      setPhase(ctx.gpsReady ? "settle-btn" : "gps");
      setTick((t) => t + 1);
      return;
    }
    if (phase === "live") {
      setPhase("tips-gather");
      return;
    }
    const idx = TIP_ORDER.indexOf(phase);
    if (idx >= 0) {
      if (idx >= TIP_ORDER.length - 1) finish();
      else setPhase(TIP_ORDER[idx + 1]!);
      return;
    }
  };

  const tipPos: CSSProperties = (() => {
    // Keep the map clear while planting — tip sits low
    if (phase === "place-house" || phase === "place-villager") {
      return {
        left: "50%",
        bottom: "max(5.5rem, calc(env(safe-area-inset-bottom) + 4.5rem))",
        transform: "translateX(-50%)",
      };
    }
    if (!rect) {
      return {
        left: "50%",
        bottom: "max(1.25rem, env(safe-area-inset-bottom))",
        transform: "translateX(-50%)",
      };
    }
    const midY = rect.top + rect.height / 2;
    // Target in lower half → float tip above it
    if (midY > 280) {
      return {
        left: "50%",
        top: Math.max(12, rect.top - 12),
        transform: "translate(-50%, -100%)",
      };
    }
    // Target near top → tip below
    return {
      left: "50%",
      top: rect.top + rect.height + 12,
      transform: "translateX(-50%)",
    };
  })();

  return (
    <div
      data-guide-root
      className={`guide-root absolute inset-0 z-[70] ${
        tip.blocking ? "guide-root-blocking" : "guide-root-pass"
      }`}
      role="dialog"
      aria-modal={tip.blocking ? true : undefined}
      aria-label="Setup guide"
    >
      {tip.blocking && (
        <div className="guide-scrim absolute inset-0" aria-hidden />
      )}

      {/* Pulsing spotlight around the control */}
      {rect && !tip.blocking && (
        <div
          className="guide-pulse-ring pointer-events-none"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
          aria-hidden
        />
      )}

      {/* Coach card */}
      <div
        className={`guide-card pointer-events-auto w-[min(21rem,calc(100%-1.25rem))] p-3.5 ${
          tip.blocking ? "guide-card-center" : ""
        }`}
        style={tip.blocking ? undefined : tipPos}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-mono text-[8px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
              {ctx.claimed && TIP_ORDER.includes(phase)
                ? "How to play"
                : "Setup guide"}
              {ctx.sectorName ? ` · ${ctx.sectorName}` : ""}
            </p>
            <h2 className="mt-1 font-display text-xl text-[var(--ink)] sm:text-2xl">
              {tip.title}
            </h2>
          </div>
          <button
            type="button"
            className="shrink-0 font-mono text-[11px] text-[var(--ink-faint)] hover:text-[var(--sand)]"
            onClick={finish}
          >
            Skip
          </button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">
          {tip.body}
        </p>
        {tip.blocking ? (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              className="rounded-sm bg-[var(--signal)] px-4 py-2 text-sm font-bold text-white"
              onClick={advance}
            >
              {tip.cta ?? "Next"}
            </button>
          </div>
        ) : (
          <p className="mt-2 font-mono text-[9px] text-[var(--sand)]">
            {phase === "place-house" || phase === "place-villager"
              ? "Tap the blinking spot on the map to continue…"
              : "Tap the blinking control to continue…"}
          </p>
        )}
      </div>
    </div>
  );
}

export function readWalkthroughDone(): boolean {
  try {
    return window.localStorage.getItem(WALKTHROUGH_KEY) === "1";
  } catch {
    return false;
  }
}
