"use client";

import { useEffect, useRef, useState } from "react";
import { KohMascot } from "./KohMascot";

interface LoadingScreenProps {
  /** When true, begin fade-out */
  ready?: boolean;
  /** Minimum time visible (ms) so it doesn't flash */
  minDuration?: number;
  label?: string;
  onDone?: () => void;
}

/** Full-viewport splash — the only Koh loader on first paint */
export function LoadingScreen({
  ready = false,
  minDuration = 900,
  label = "Finding spots in Islamabad…",
  onDone,
}: LoadingScreenProps) {
  const [exiting, setExiting] = useState(false);
  const [gone, setGone] = useState(false);
  const startedAt = useRef(Date.now());
  const onDoneRef = useRef(onDone);
  const finished = useRef(false);
  const armed = useRef(false);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!ready || armed.current || finished.current) return;
    armed.current = true;

    const wait = Math.max(0, minDuration - (Date.now() - startedAt.current));

    // Intentionally no cleanup — Strict Mode was cancelling the exit timer
    // and leaving the splash stuck until a failsafe fired.
    window.setTimeout(() => {
      if (finished.current) return;
      setExiting(true);
      window.setTimeout(() => {
        if (finished.current) return;
        finished.current = true;
        setGone(true);
        onDoneRef.current?.();
      }, 400);
    }, wait);
  }, [ready, minDuration]);

  // Absolute failsafe — long enough for Standard style + terrain to settle
  // before we uncover the map (see AppSplash / onMapReadyToShow).
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (finished.current) return;
      finished.current = true;
      setExiting(true);
      setGone(true);
      onDoneRef.current?.();
    }, 10000);
    return () => window.clearTimeout(t);
  }, []);

  if (gone) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-surface transition-opacity duration-[400ms] ease-out ${
        exiting ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      role="status"
      aria-live="polite"
      aria-busy={!ready}
    >
      <div className="loader-wash" aria-hidden />
      <div className="relative flex flex-col items-center gap-4">
        <div className="koh-loader-ring koh-loader-ring-lg">
          <KohMascot size={80} mood="run" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold tracking-tight text-ink">
            Islamabad Explore
          </p>
          <p className="mt-0.5 text-xs font-medium text-ink-muted">
            Community map of spots in Islamabad
          </p>
          <p className="mt-1 text-sm text-ink-muted">{label}</p>
        </div>
        <div className="loader-bar" aria-hidden>
          <span />
        </div>
      </div>
    </div>
  );
}

/** Quiet placeholder — dots only, no mascot */
export function QuietLoader({
  label = "Loading…",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 py-20 ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="loader-dots" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <p className="text-sm text-ink-muted">{label}</p>
    </div>
  );
}

interface AppSplashProps {
  children: React.ReactNode;
  ready: boolean;
  onIntroDone?: () => void;
}

/**
 * Opaque full-screen splash. Children mount underneath (data/map load)
 * but only this one Koh is visible until ready.
 */
export function AppSplash({ children, ready, onIntroDone }: AppSplashProps) {
  const [showSplash, setShowSplash] = useState(true);
  const onIntroDoneRef = useRef(onIntroDone);
  const dismissed = useRef(false);
  onIntroDoneRef.current = onIntroDone;

  const dismiss = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    setShowSplash(false);
    onIntroDoneRef.current?.();
  };

  useEffect(() => {
    if (!showSplash) return;
    const t = window.setTimeout(dismiss, 12000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSplash]);

  return (
    <>
      {children}
      {showSplash && (
        <LoadingScreen
          ready={ready}
          onDone={dismiss}
          label="Finding spots in Islamabad…"
        />
      )}
    </>
  );
}
