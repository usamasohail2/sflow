"use client";

import { useEffect } from "react";
import { KohMascot } from "./KohMascot";

const STORAGE_KEY = "isb-explore-welcome-seen";

interface WelcomeModalProps {
  open: boolean;
  onClose: () => void;
  onAddSpot: () => void;
}

export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markWelcomeSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // ignore
  }
}

export function WelcomeModal({ open, onClose, onAddSpot }: WelcomeModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="koh-about-overlay fixed inset-0 z-[75] flex items-center justify-center p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        className="koh-about-window relative w-full max-w-[440px] outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="koh-about-titlebar">
          <span className="koh-about-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="font-pixel text-[10px] tracking-wide text-[#f4e8c8] sm:text-[11px]">
            WELCOME.EXE
          </span>
          <button
            type="button"
            onClick={onClose}
            className="koh-about-x font-pixel"
            aria-label="Close"
          >
            X
          </button>
        </div>

        <div className="koh-about-body">
          <div className="koh-about-scanlines" aria-hidden />
          <div className="relative flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="koh-about-sprite shrink-0">
              <KohMascot size={72} mood="wave" label="Koh" />
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <p
                id="welcome-title"
                className="font-pixel text-[11px] uppercase leading-relaxed tracking-wide text-[#7dff9a] sm:text-[12px]"
              >
                Islamabad Explore
              </p>
              <p className="mt-2 font-pixel text-[9px] uppercase tracking-wider text-[#c8b48a]">
                A community map of spots
              </p>
            </div>
          </div>

          <div className="koh-about-copy mt-4 space-y-3 font-pixel text-[9px] uppercase leading-[1.9] tracking-wide text-[#f0e6c8] sm:text-[10px]">
            <p>
              Browse the map for cafés, trails, hangouts, and hidden gems in
              Islamabad. Tap a pin to open the details.
            </p>
            <p>
              Colored pins = categories. Amber = waiting for a human to verify.
            </p>
            <p>
              Know something good? Add it. New pins stay pending until verified,
              then they go live for everyone.
            </p>
            <p className="text-[#7dff9a]">
              &gt; Press X to close. Or click the fog.
              <span className="koh-about-cursor" aria-hidden>
                _
              </span>
            </p>
          </div>

          <div className="relative mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => {
                onClose();
                onAddSpot();
              }}
              className="koh-about-btn flex-1 font-pixel uppercase"
            >
              Add a spot
            </button>
            <button
              type="button"
              onClick={onClose}
              className="koh-about-btn koh-about-btn-secondary flex-1 font-pixel uppercase"
            >
              Explore map
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
