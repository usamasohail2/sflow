"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage } from "@/lib/presenceTypes";
import { usePublicChat } from "@/hooks/usePublicChat";

interface PublicChatProps {
  visitorId: string;
  displayName: string;
  onSent?: (text: string) => void;
  onRename?: (name: string) => void;
  className?: string;
}

function formatTime(t: number) {
  try {
    return new Date(t).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function PublicChat({
  visitorId,
  displayName,
  onSent,
  onRename,
  className = "",
}: PublicChatProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [nameDraft, setNameDraft] = useState(displayName);
  const listRef = useRef<HTMLDivElement>(null);
  const { messages, sending, error, send } = usePublicChat({
    enabled: Boolean(visitorId),
    visitorId,
    displayName,
    onSent,
  });

  useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (nameDraft.trim() && nameDraft.trim() !== displayName) {
      onRename?.(nameDraft.trim());
    }
    const ok = await send(draft);
    if (ok) setDraft("");
  };

  return (
    <div
      className={`pointer-events-auto flex flex-col items-end gap-2 ${className}`}
    >
      {open && (
        <div className="public-chat-panel flex w-[min(20rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-line bg-surface/95 shadow-[0_12px_40px_rgba(0,0,0,0.18)] backdrop-blur-md dark:bg-surface-raised/95">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-ink">
                Public chat
              </p>
              <p className="truncate text-[10px] text-ink-muted">
                Messages appear above people on the map
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Collapse chat"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-sm text-ink transition hover:bg-wash"
            >
              −
            </button>
          </div>

          <div
            ref={listRef}
            className="flex max-h-52 flex-col gap-2 overflow-y-auto px-3 py-2"
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <p className="py-4 text-center text-[11px] text-ink-muted">
                No messages yet — say hi
              </p>
            ) : (
              messages.map((m) => (
                <ChatLine
                  key={m.id}
                  message={m}
                  mine={m.visitorId === visitorId}
                />
              ))
            )}
          </div>

          <form
            onSubmit={onSubmit}
            className="flex flex-col gap-1.5 border-t border-line px-2.5 py-2"
          >
            <label className="flex items-center gap-1.5 text-[10px] text-ink-muted">
              <span className="shrink-0">As</span>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => {
                  if (nameDraft.trim() && nameDraft.trim() !== displayName) {
                    onRename?.(nameDraft.trim());
                  }
                }}
                maxLength={32}
                className="min-w-0 flex-1 rounded-md border border-line bg-wash px-1.5 py-0.5 text-[11px] font-semibold text-ink outline-none focus:border-[var(--blue)]"
                aria-label="Display name"
              />
            </label>
            <div className="flex items-center gap-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={140}
                placeholder="Say something…"
                className="min-w-0 flex-1 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink outline-none placeholder:text-ink-muted focus:border-[var(--blue)]"
                aria-label="Chat message"
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--blue)_40%,transparent)] bg-[var(--blue)] px-3 py-1.5 text-xs font-semibold text-white transition enabled:hover:brightness-110 disabled:opacity-40"
              >
                Send
              </button>
            </div>
            {error && (
              <p className="px-1 text-[10px] text-danger">{error}</p>
            )}
            {/* honeypot reserved for bots via API body.website */}
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Hide public chat" : "Open public chat"}
        className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink shadow-sm transition hover:bg-wash dark:bg-surface-raised"
      >
        <ChatIcon />
        <span>{open ? "Hide chat" : "Public chat"}</span>
        {!open && messages.length > 0 && (
          <span className="rounded-full bg-wash px-1.5 py-0.5 text-[10px] tabular-nums text-ink-muted">
            {messages.length}
          </span>
        )}
      </button>
    </div>
  );
}

function ChatLine({
  message,
  mine,
}: {
  message: ChatMessage;
  mine: boolean;
}) {
  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div className="flex max-w-[95%] items-baseline gap-1.5">
        <span className="truncate text-[10px] font-bold text-ink">
          {message.name}
        </span>
        <span className="shrink-0 text-[9px] tabular-nums text-ink-muted">
          {formatTime(message.t)}
        </span>
      </div>
      <p
        className={`mt-0.5 max-w-[95%] rounded-2xl px-2.5 py-1 text-[11px] leading-snug text-ink ${
          mine
            ? "rounded-br-md bg-[color-mix(in_srgb,var(--blue)_16%,var(--surface))]"
            : "rounded-bl-md bg-wash"
        }`}
      >
        {message.text}
      </p>
    </div>
  );
}

function ChatIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M2.5 3.5h11v7.5H8l-3 2v-2H2.5V3.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
