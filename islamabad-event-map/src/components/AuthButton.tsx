"use client";

import { useEffect, useId, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { isFounderEmail } from "@/lib/founder";

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
    const founder = isFounderEmail(email);

    return (
      <div ref={rootRef} className="pointer-events-auto relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-controls={menuId}
          className={`inline-flex h-9 max-w-[10.5rem] items-center gap-1.5 rounded-full border bg-surface pl-1 pr-2.5 text-xs font-semibold shadow-sm transition hover:bg-wash ${
            founder
              ? "border-[#C9A227] text-[#C9A227]"
              : "border-line text-ink"
          }`}
        >
          {session.user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session.user.image}
              alt=""
              className={`h-7 w-7 rounded-full object-cover ${
                founder
                  ? "ring-2 ring-[#C9A227] ring-offset-1 ring-offset-surface"
                  : ""
              }`}
              referrerPolicy="no-referrer"
            />
          ) : (
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white ${
                founder ? "bg-[#C9A227]" : "bg-[var(--blue)]"
              }`}
            >
              {name.charAt(0).toUpperCase()}
            </span>
          )}
          {founder && (
            <svg
              className="h-3 w-3 shrink-0 text-[#C9A227]"
              viewBox="0 0 16 16"
              aria-hidden
            >
              <path
                fill="currentColor"
                d="M8 1.2 9.8 5.6l4.7.4-3.6 3.1 1.1 4.6L8 11.4l-4 2.3 1.1-4.6L1.5 6l4.7-.4L8 1.2z"
              />
            </svg>
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
              <p className="inline-flex items-center gap-1 truncate text-xs font-semibold text-ink">
                {founder && (
                  <svg
                    className="h-3 w-3 shrink-0 text-[#C9A227]"
                    viewBox="0 0 16 16"
                    aria-hidden
                  >
                    <path
                      fill="currentColor"
                      d="M8 1.2 9.8 5.6l4.7.4-3.6 3.1 1.1 4.6L8 11.4l-4 2.3 1.1-4.6L1.5 6l4.7-.4L8 1.2z"
                    />
                  </svg>
                )}
                {name}
              </p>
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

  return <GoogleSignInButton compact callbackUrl="/" />;
}
