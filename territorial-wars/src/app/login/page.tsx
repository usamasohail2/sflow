"use client";

import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import Link from "next/link";
import { useEffect, useState } from "react";

const INVITE_KEY = "itw_invite";

function playCallbackUrl(): string {
  try {
    const fromUrl = new URLSearchParams(window.location.search)
      .get("invite")
      ?.trim()
      .toUpperCase();
    if (fromUrl) {
      window.localStorage.setItem(INVITE_KEY, fromUrl);
      return `/play?invite=${encodeURIComponent(fromUrl)}`;
    }
    const stored = window.localStorage.getItem(INVITE_KEY);
    if (stored) return `/play?invite=${encodeURIComponent(stored)}`;
  } catch {
    /* ignore */
  }
  return "/play";
}

export default function LoginPage() {
  const [callbackUrl, setCallbackUrl] = useState("/play");

  useEffect(() => {
    setCallbackUrl(playCallbackUrl());
  }, []);

  return (
    <main className="war-grid flex min-h-[100dvh] flex-col items-center justify-center px-5">
      <h1 className="font-display text-3xl text-[var(--ink)]">Sign in</h1>
      <p className="mt-2 max-w-sm text-center text-sm text-[var(--ink-muted)]">
        Continue with Google to keep your sector, arsenal, and battle reports
        across devices.
      </p>
      <div className="mt-6">
        <GoogleSignInButton callbackUrl={callbackUrl} />
      </div>
      <Link href="/" className="mt-8 text-xs text-[var(--ink-faint)]">
        Back
      </Link>
    </main>
  );
}
