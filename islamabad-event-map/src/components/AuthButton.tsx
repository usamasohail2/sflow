"use client";

import { useEffect, useId, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";

export function AuthButton() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
    const email = session.user.email ?? "";

    return (
      <div ref={rootRef} className="pointer-events-auto relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-controls={menuId}
          className="inline-flex h-9 max-w-[9.5rem] items-center gap-1.5 rounded-full border border-line bg-surface pl-1 pr-2.5 text-xs font-semibold text-ink shadow-sm transition hover:bg-wash"
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

        {open && (
          <div
            id={menuId}
            role="menu"
            className="absolute right-0 top-[calc(100%+0.35rem)] z-50 w-52 overflow-hidden rounded-xl border border-line bg-surface shadow-sm"
          >
            <div className="border-b border-line px-3 py-2">
              <p className="truncate text-xs font-semibold text-ink">{name}</p>
              {email ? (
                <p className="mt-0.5 truncate text-[10px] text-ink-muted">
                  {email}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              role="menuitem"
              disabled={loggingOut}
              onClick={() => {
                setLoggingOut(true);
                void signOut({ callbackUrl: "/" });
              }}
              className="flex w-full items-center px-3 py-2.5 text-left text-xs font-semibold text-ink transition hover:bg-wash disabled:opacity-60"
            >
              {loggingOut ? "Logging out…" : "Log out"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Start Google OAuth immediately (skip /login hop)
  return <GoogleSignInButton compact callbackUrl="/" />;
}
