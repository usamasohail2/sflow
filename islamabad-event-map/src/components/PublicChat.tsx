"use client";

import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/hooks/usePublicChat";
import { EXPLORER_PALETTES } from "@/hooks/useLivePresence";
import { FOUNDER_PALETTE, isFounderColor } from "@/lib/founder";

export interface PublicChatHandle {
  messages: ChatMessage[];
  selfId: string;
  displayName: string;
  sending: boolean;
  sendError?: string | null;
  onSend: (text: string) => Promise<boolean>;
}

interface PublicChatProps extends PublicChatHandle {
  className?: string;
  /** Controlled open state (mobile). When omitted, desktop defaults to open. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * mobile — collapsed bar under spots; tap expands chat and parent hides spots
   * desktop — panel above spots, open by default
   */
  layout?: "desktop" | "mobile";
}

/** Flat prompt when the visitor isn’t signed in */
export function PublicChatSignIn({
  className = "",
  layout = "desktop",
}: {
  className?: string;
  layout?: "desktop" | "mobile";
}) {
  const isMobile = layout === "mobile";
  return (
    <div
      className={`pointer-events-auto flex items-center justify-between gap-2 rounded-2xl border border-line bg-surface px-3 py-2.5 shadow-sm ${
        isMobile ? "w-full" : "w-[min(100%,18.5rem)]"
      } ${className}`}
    >
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-ink">Public chat</span>
        <span className="mt-0.5 block text-[11px] text-ink-muted">
          Sign in with Google to chat
        </span>
      </span>
      <GoogleSignInButton
        compact
        callbackUrl="/"
        className="!shadow-none"
      />
    </div>
  );
}

export function PublicChat({
  messages,
  selfId,
  displayName,
  sending,
  sendError = null,
  onSend,
  className = "",
  open: openProp,
  onOpenChange,
  layout = "desktop",
}: PublicChatProps) {
  const isMobile = layout === "mobile";
  const [uncontrolledOpen, setUncontrolledOpen] = useState(!isMobile);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (openProp === undefined) setUncontrolledOpen(next);
  };

  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !open) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, open]);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const submit = async () => {
    const text = draft;
    if (!text.trim() || sending) return;
    const ok = await onSend(text);
    if (ok) {
      setDraft("");
      inputRef.current?.focus();
    }
  };

  const latest = messages[messages.length - 1];

  // Mobile collapsed: bar under spots
  if (isMobile && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`pointer-events-auto flex w-full items-center justify-between gap-2 rounded-2xl border border-line bg-surface px-3 py-2.5 text-left shadow-sm ${className}`}
        aria-expanded={false}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-ink">
            Public chat
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
            {latest
              ? `${latest.visitorId === selfId ? "You" : latest.name}: ${latest.text}`
              : "Tap to open — say hi to explorers"}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-wash px-2 py-1 text-[10px] font-semibold text-ink-muted">
          Open
        </span>
      </button>
    );
  }

  return (
    <div
      className={`pointer-events-auto flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm ${
        isMobile ? "w-full" : "w-[min(100%,18.5rem)]"
      } ${className}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-xs font-semibold text-ink">Public chat</span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-[10px] font-medium text-ink-muted transition hover:text-ink"
          aria-expanded={open}
        >
          {isMobile ? (open ? "Back to spots" : "Open") : open ? "Hide" : "Show"}
        </button>
      </div>

      {open && (
        <>
          <div
            ref={listRef}
            className={`flex flex-col gap-1.5 overflow-y-auto px-2.5 py-2 ${
              isMobile ? "max-h-[42dvh]" : "max-h-40 sm:max-h-48"
            }`}
          >
            {messages.length === 0 ? (
              <p className="px-1 py-3 text-center text-[11px] text-ink-faint">
                Say hi — messages float above explorers for 10s.
              </p>
            ) : (
              messages.map((msg) => {
                const mine = msg.visitorId === selfId;
                const star = msg.star === true || isFounderColor(msg.color);
                const palette = star
                  ? FOUNDER_PALETTE
                  : EXPLORER_PALETTES[msg.color % EXPLORER_PALETTES.length]!;
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                  >
                    <span
                      className="mb-0.5 inline-flex items-center gap-0.5 text-[9px] font-semibold"
                      style={{ color: star ? FOUNDER_PALETTE.shirt : palette.shirt }}
                    >
                      {star && (
                        <svg
                          className="h-2.5 w-2.5"
                          viewBox="0 0 16 16"
                          aria-hidden
                        >
                          <path
                            fill="currentColor"
                            d="M8 1.2 9.8 5.6l4.7.4-3.6 3.1 1.1 4.6L8 11.4l-4 2.3 1.1-4.6L1.5 6l4.7-.4L8 1.2z"
                          />
                        </svg>
                      )}
                      {mine ? "You" : msg.name}
                    </span>
                    <span
                      className={`max-w-[95%] rounded-2xl px-2.5 py-1 text-[11px] leading-snug ${
                        mine
                          ? star
                            ? "rounded-br-md bg-[#C9A227] text-[#1a1508]"
                            : "rounded-br-md bg-[var(--blue)] text-white"
                          : star
                            ? "rounded-bl-md border border-[#C9A227]/40 bg-[#1a1508] text-[#FFE566]"
                            : "rounded-bl-md bg-wash text-ink"
                      }`}
                    >
                      {msg.text}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <form
            className="flex flex-col gap-1 border-t border-line p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={160}
                placeholder={
                  selfId ? `Chat as ${displayName}…` : "Connecting…"
                }
                className="min-w-0 flex-1 rounded-full border border-line bg-wash px-3 py-1.5 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-[var(--blue)]"
                disabled={sending || !selfId}
              />
              <button
                type="submit"
                disabled={sending || !draft.trim() || !selfId}
                className="shrink-0 rounded-full bg-[var(--blue)] px-2.5 py-1.5 text-[11px] font-semibold text-white transition enabled:hover:opacity-90 disabled:opacity-40"
              >
                {sending ? "…" : "Send"}
              </button>
            </div>
            {sendError && (
              <p className="px-1 text-[10px] font-medium text-danger">
                {sendError}
              </p>
            )}
          </form>
        </>
      )}
    </div>
  );
}
