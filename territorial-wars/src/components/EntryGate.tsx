"use client";

import Link from "next/link";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { WorldBackdrop } from "@/components/WorldBackdrop";

type Props = {
  /** Google sign-in (logged-out /play) vs link to /play (marketing home) */
  mode: "signin" | "link";
  callbackUrl?: string;
};

/**
 * First screen: Islamabad behind, brand + Play at the bottom.
 * Kept plain on purpose — no marketing paragraphs.
 */
export function EntryGate({ mode, callbackUrl = "/play" }: Props) {
  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[var(--surface)]">
      <WorldBackdrop className="absolute inset-0" />

      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-20">
        <h1 className="entry-brand text-center font-display text-[clamp(2.1rem,8vw,3.4rem)] leading-[0.95] tracking-tight text-[var(--ink)]">
          Islamabad
          <span className="mt-1 block text-[var(--signal-bright)]">
            Territorial Wars
          </span>
        </h1>

        <div className="entry-play mt-7">
          {mode === "signin" ? (
            <GoogleSignInButton callbackUrl={callbackUrl} label="Play" />
          ) : (
            <Link href="/play" className="entry-play-btn">
              Play
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
