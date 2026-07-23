"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

function GoogleGlyph({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7 12.9 19.6C14.7 15.1 19 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.3 35.2 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-8H6.2C9.7 37.1 16.3 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4 5.3v.1l6.3 5.3C40.4 36.1 44 30.7 44 24c0-1.3-.1-2.5-.4-3.5z"
      />
    </svg>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Client-side Google OAuth — shows immediate loading, then redirects */
export function GoogleSignInButton({
  callbackUrl = "/",
  label = "Continue with Google",
  className = "",
  compact = false,
}: {
  callbackUrl?: string;
  label?: string;
  className?: string;
  /** Header-sized control */
  compact?: boolean;
}) {
  const [pending, setPending] = useState(false);

  const start = () => {
    if (pending) return;
    setPending(true);
    void signIn("google", { callbackUrl }).catch(() => {
      setPending(false);
    });
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={start}
        disabled={pending}
        aria-busy={pending}
        aria-label={pending ? "Signing in…" : "Sign in with Google"}
        className={`pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-xs font-semibold text-ink shadow-sm transition hover:bg-wash disabled:opacity-70 sm:px-3 ${className}`}
      >
        {pending ? (
          <Spinner className="h-4 w-4 shrink-0 text-ink-muted" />
        ) : (
          <GoogleGlyph className="h-4 w-4 shrink-0" />
        )}
        <span className="hidden sm:inline">
          {pending ? "Signing in…" : "Sign in"}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={pending}
      aria-busy={pending}
      className={`flex w-full items-center justify-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-wash disabled:cursor-wait disabled:opacity-80 ${className}`}
    >
      {pending ? (
        <Spinner className="h-5 w-5 shrink-0 text-ink-muted" />
      ) : (
        <GoogleGlyph className="h-5 w-5 shrink-0" />
      )}
      {pending ? "Redirecting to Google…" : label}
    </button>
  );
}
