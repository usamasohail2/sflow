"use client";

import { useEffect, useState } from "react";

export const WALKTHROUGH_KEY = "itw_walkthrough_v1";

export type WalkStep = {
  id: string;
  title: string;
  body: string;
};

const STEPS: WalkStep[] = [
  {
    id: "welcome",
    title: "Welcome, settler",
    body: "Islamabad is split into sectors. Settle one with friends — your walls glow blue, allies in your sector are green, rivals elsewhere are red.",
  },
  {
    id: "settle",
    title: "Settle your village",
    body: "Tap a sector, confirm your GPS if asked, then place a house and a villager nearby. That starts your village.",
  },
  {
    id: "gather",
    title: "Villagers gather for you",
    body: "Your villager walks out, digs, and brings gold home on a loop. More villagers and buildings mean more gold per trip.",
  },
  {
    id: "explore",
    title: "Zoom in to explore",
    body: "Zoom into the streets and roam your sector. Rare resources spawn as you explore — tap them to collect.",
  },
  {
    id: "build",
    title: "Build & arm",
    body: "Spend gold in Build to place mills and turrets. Stock rockets in Arsenal — you choose how many to fire when you raid.",
  },
  {
    id: "raid",
    title: "Raid rivals",
    body: "Tap an enemy house or building in another sector, pick your salvo, and fire. Same-sector settlers are allies — you can't attack them.",
  },
  {
    id: "invite",
    title: "Invite for villagers",
    body: "Share your invite link. Every friend who joins with it gives you +1 villager — permanent gather power. Find Invite in the menu.",
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export function Walkthrough({ open, onClose }: Props) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  if (!open) return null;

  const cur = STEPS[step]!;
  const last = step >= STEPS.length - 1;
  const progress = ((step + 1) / STEPS.length) * 100;

  const finish = () => {
    try {
      window.localStorage.setItem(WALKTHROUGH_KEY, "1");
    } catch {
      /* ignore */
    }
    onClose();
  };

  return (
    <div
      className="walkthrough-overlay absolute inset-0 z-[70] flex items-end justify-center px-3 pb-6 sm:items-center sm:pb-0"
      role="dialog"
      aria-modal="true"
      aria-label="How to play"
    >
      <div className="walkthrough-card pointer-events-auto w-[min(22rem,calc(100%-1rem))] p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-mono text-[8px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
              How to play · {step + 1}/{STEPS.length}
            </p>
            <h2 className="mt-1 font-display text-2xl text-[var(--ink)]">
              {cur.title}
            </h2>
          </div>
          <button
            type="button"
            className="font-mono text-[11px] text-[var(--ink-faint)] hover:text-[var(--sand)]"
            onClick={finish}
          >
            Skip
          </button>
        </div>

        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--wash)]">
          <div
            className="h-full bg-[var(--sand)] transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <p className="mt-3 text-sm leading-relaxed text-[var(--ink-muted)]">
          {cur.body}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            className="font-mono text-[10px] text-[var(--ink-faint)] underline decoration-dotted disabled:opacity-30"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </button>
          <button
            type="button"
            className="rounded-sm bg-[var(--signal)] px-4 py-2 text-sm font-bold text-white"
            onClick={() => {
              if (last) finish();
              else setStep((s) => s + 1);
            }}
          >
            {last ? "Start playing" : "Next"}
          </button>
        </div>
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
