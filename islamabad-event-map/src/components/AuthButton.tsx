"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";

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

export function AuthButton() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div
        className="h-9 w-9 shrink-0 animate-pulse rounded-full border border-line bg-wash"
        aria-hidden
      />
    );
  }

  if (session?.user) {
    const name = session.user.name?.split(" ")[0] ?? "You";
    return (
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/" })}
        title={`Signed in as ${session.user.email ?? name}. Click to sign out.`}
        aria-label={`Sign out (${name})`}
        className="pointer-events-auto inline-flex h-9 max-w-[9.5rem] items-center gap-1.5 rounded-full border border-line bg-surface pl-1 pr-2.5 text-xs font-semibold text-ink shadow-sm transition hover:bg-wash"
      >
        {session.user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={session.user.image}
            alt=""
            className="h-7 w-7 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--blue)] text-[11px] font-bold text-white">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="truncate">{name}</span>
      </button>
    );
  }

  return (
    <Link
      href="/login"
      aria-label="Sign in with Google"
      className="pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-xs font-semibold text-ink shadow-sm transition hover:bg-wash sm:px-3"
    >
      <GoogleGlyph className="h-4 w-4 shrink-0" />
      <span className="hidden sm:inline">Sign in</span>
    </Link>
  );
}
