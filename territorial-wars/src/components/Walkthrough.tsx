"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AZAD_ARENA_NAME } from "@/lib/gameTypes";

/** Bumped: leaderboard-first tips + punchier copy */
export const WALKTHROUGH_KEY = "itw_walkthrough_v5";

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
  | "tips-invite"
  | "tips-board";

export type GuideContext = {
  claimed: boolean;
  gpsReady: boolean;
  /** Current placement kind, if any */
  placingKind: string | null;
  sectorName: string | null;
  /** Live GPS is outside every mapped sector */
  offMap: boolean;
  /** Player chose Azad Umeed Wars (no sector walls) */
  azadMode: boolean;
  /** Start the off-map Azad settle flow */
  onPlayOffMap?: () => void;
};

type TipDef = {
  title: string;
  body: string;
  /** Optional one-line stinger under the title */
  goal?: string;
  /** data-guide id to spotlight; null = centered modal */
  target: string | null;
  /** Blocking overlay (welcome / tips). Interactive steps leave the map clickable. */
  blocking: boolean;
  cta?: string;
};

function tipFor(phase: GuidePhase, ctx: GuideContext): TipDef {
  if (phase === "gps" && ctx.offMap) {
    return {
      title: "You’re off the grid",
      body: `No Islamabad sector under your pin. Jump into ${AZAD_ARENA_NAME} — same grind, no walls, its own ranking.`,
      target: "guide-azad",
      blocking: false,
    };
  }
  if (phase === "settle-btn" && ctx.azadMode) {
    return {
      title: "Drop the flag",
      body: `Pin locked for ${AZAD_ARENA_NAME}. Hit Settle, then plant a base by your marker.`,
      target: "guide-settle",
      blocking: false,
    };
  }
  if (phase === "place-house" && ctx.azadMode) {
    return {
      title: "Plant the base",
      body: `Tap near your pin. No sector walls here — green ring means the ground is yours.`,
      target: "guide-place-banner",
      blocking: false,
    };
  }
  if (phase === "live" && ctx.azadMode) {
    return {
      title: "Live in the wild",
      body: `Welcome to ${AZAD_ARENA_NAME}. Villagers haul gold while you spend it on buildings and rockets. Climb that separate board.`,
      goal: "Goal: sit #1 on the leaderboard",
      target: null,
      blocking: true,
      cta: "How do I climb?",
    };
  }

  const base: Record<GuidePhase, TipDef> = {
    welcome: {
      title: "Own the board",
      body: "Settle a village in Islamabad, farm gold, raid your neighbors. Rank is everything — if you’re not climbing, you’re losing ground.",
      goal: "The goal: #1 on the leaderboard",
      target: null,
      blocking: true,
      cta: "Start settling",
    },
    gps: {
      title: "Lock your spot",
      body: "Tap the blinking control to pin GPS to this sector. Off every sector? Take Azad Umeed Wars below.",
      target: "guide-gps",
      blocking: false,
    },
    "settle-btn": {
      title: "Claim the dirt",
      body: "GPS is locked. Hit Settle — next you plant a base that marks your home sector.",
      target: "guide-settle",
      blocking: false,
    },
    "place-house": {
      title: "Plant the base",
      body: "Tap inside the walls. Green ring = clear. That spot is your village center for the rest of the war.",
      target: "guide-place-banner",
      blocking: false,
    },
    "place-villager": {
      title: "Station a gatherer",
      body: "Tap nearby. They walk out, dig, and haul gold home on a loop — free income while you scheme.",
      target: "guide-place-banner",
      blocking: false,
    },
    live: {
      title: "You’re on the map",
      body: "Blue walls = home. Gold ticks in while you play. Every mill, rocket, and raid is another rung toward #1.",
      goal: "Goal: sit #1 on the leaderboard",
      target: null,
      blocking: true,
      cta: "How do I climb?",
    },
    "tips-gather": {
      title: "Gold is the ladder",
      body: "Watch your villager farm. Zoom into the streets and roam — rare finds spawn for whoever taps them first.",
      target: null,
      blocking: true,
      cta: "Next",
    },
    "tips-build": {
      title: "Spend like it matters",
      body: "Mills and wells juice gather rate. Stock rockets in Arsenal. Empty pockets don’t take sectors.",
      target: null,
      blocking: true,
      cta: "Next",
    },
    "tips-raid": {
      title: "Make them rebuild",
      body: "Tap an enemy base or building, pick a salvo, fire. Allies glow green — you can still clear their buildings if you need the ground.",
      target: null,
      blocking: true,
      cta: "Next",
    },
    "tips-invite": {
      title: "Friends = free labor",
      body: "Menu → Invite. Each friend who joins on your link permanently adds a villager. More hands, more gold, higher rank.",
      target: null,
      blocking: true,
      cta: "Next",
    },
    "tips-board": {
      title: "Win = top the board",
      body: "Open Charts / your sector ranking. Farm harder, raid smarter, invite denser. Stay #1 and you get to rename the sector.",
      goal: "Everything else is just how you get there",
      target: null,
      blocking: true,
      cta: "Go climb",
    },
  };
  return base[phase];
}

const TIP_ORDER: GuidePhase[] = [
  "tips-gather",
  "tips-build",
  "tips-raid",
  "tips-invite",
  "tips-board",
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

  // Fresh run each time the tour opens — prefer post-settle tips
  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    setPhase(ctx.claimed ? "live" : "welcome");
    setTick((t) => t + 1);
  }, [open, ctx.claimed]);

  // If GPS proves off-map while stuck on gps, retarget the Azad control
  useEffect(() => {
    if (!open || ctx.claimed) return;
    if (phase === "gps" && ctx.offMap) {
      setTick((t) => t + 1);
    }
  }, [open, ctx.claimed, ctx.offMap, phase]);

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

  const tip = tipFor(phase, ctx);

  // Blink class on the live target element
  useEffect(() => {
    if (!open) return;
    const id = tip.target;
    if (!id) return;
    const el = document.querySelector(`[data-guide="${id}"]`);
    if (!el) return;
    el.classList.add("is-guide-hot");
    return () => el.classList.remove("is-guide-hot");
  }, [open, phase, tick, ctx.gpsReady, ctx.placingKind, ctx.offMap, tip.target]);

  const rect = useTargetRect(tip.target, open, tick);

  if (!open) return null;

  const finish = () => {
    markDone();
    onClose();
  };

  const advance = () => {
    if (phase === "welcome") {
      if (ctx.offMap && !ctx.gpsReady) {
        setPhase("gps");
        setTick((t) => t + 1);
        return;
      }
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

  const tipIndex = TIP_ORDER.indexOf(phase);
  const showHowToPlay = ctx.claimed && tipIndex >= 0;

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
              {showHowToPlay
                ? `How to climb · ${tipIndex + 1}/${TIP_ORDER.length}`
                : "Setup"}
              {ctx.sectorName ? ` · ${ctx.sectorName}` : ""}
            </p>
            <h2 className="mt-1 font-display text-xl text-[var(--ink)] sm:text-2xl">
              {tip.title}
            </h2>
            {tip.goal && (
              <p className="mt-1.5 inline-block border border-[var(--sand)]/45 bg-[var(--wash)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--sand)]">
                {tip.goal}
              </p>
            )}
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
          <>
            <p className="mt-2 font-mono text-[9px] text-[var(--sand)]">
              {phase === "place-house" || phase === "place-villager"
                ? "Tap the blinking spot on the map to continue…"
                : "Tap the blinking control to continue…"}
            </p>
            {phase === "gps" && ctx.offMap && ctx.onPlayOffMap && (
              <button
                type="button"
                className="mt-2 w-full rounded-sm border border-[var(--sand)]/50 bg-[var(--wash)] px-3 py-2 text-xs font-bold text-[var(--sand)]"
                onClick={() => ctx.onPlayOffMap?.()}
              >
                Play {AZAD_ARENA_NAME}
              </button>
            )}
            {phase === "gps" && !ctx.offMap && ctx.onPlayOffMap && (
              <button
                type="button"
                className="mt-2 w-full text-[10px] font-mono text-[var(--ink-faint)] underline decoration-dotted underline-offset-2 hover:text-[var(--sand)]"
                onClick={() => ctx.onPlayOffMap?.()}
              >
                My location isn’t on the map
              </button>
            )}
          </>
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

export function clearWalkthroughDone(): void {
  try {
    window.localStorage.removeItem(WALKTHROUGH_KEY);
    // Clear prior keys too
    window.localStorage.removeItem("itw_walkthrough_v4");
    window.localStorage.removeItem("itw_walkthrough_v3");
    window.localStorage.removeItem("itw_walkthrough_v2");
    window.localStorage.removeItem("itw_walkthrough_v1");
  } catch {
    /* ignore */
  }
}
