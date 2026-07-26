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
  /** Panel opens below the button (top HUD) or above it (bottom HUD) */
  placement?: "top" | "bottom";
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
  placement = "bottom",
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

  /** Newest messages shown while chat is collapsed */
  const previewMessages = messages.slice(-3);

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

  const panel = open ? (
    <div className="public-chat-panel flex w-[min(18.5rem,calc(100vw-1.25rem))] flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sand)]">
            Public chat
          </p>
          <p className="truncate text-[10px] text-[var(--ink-muted)]">
            Shows above people on the map
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Collapse chat"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--line)] text-sm text-[var(--ink)] transition hover:bg-[var(--wash)]"
        >
          −
        </button>
      </div>

      <div
        ref={listRef}
        className="flex max-h-40 flex-col gap-2 overflow-y-auto px-3 py-2 sm:max-h-52"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-[var(--ink-muted)]">
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
        className="flex flex-col gap-1.5 border-t border-[var(--line)] px-2.5 py-2"
      >
        <label className="flex items-center gap-1.5 text-[10px] text-[var(--ink-muted)]">
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
            className="min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--wash)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--ink)] outline-none focus:border-[var(--field-bright)]"
            aria-label="Display name"
          />
        </label>
        <div className="flex items-center gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={140}
            placeholder="Say something…"
            className="min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--field-bright)]"
            aria-label="Chat message"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="shrink-0 rounded border border-[var(--field)] bg-[var(--field)] px-3 py-1.5 text-xs font-semibold text-white transition enabled:hover:brightness-110 disabled:opacity-40"
          >
            Send
          </button>
        </div>
        {error && (
          <p className="px-1 text-[10px] text-[var(--signal-bright)]">{error}</p>
        )}
      </form>
    </div>
  ) : null;

  const collapsedPreview =
    !open && previewMessages.length > 0 ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="public-chat-preview max-w-[min(16rem,calc(100vw-5rem))] text-left"
        title="Open chat"
      >
        <ul className="flex flex-col gap-1.5">
          {previewMessages.map((m) => (
            <li key={m.id} className="min-w-0">
              <span className="block truncate text-[10px] font-bold text-[var(--ink)]">
                {m.name}
              </span>
              <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[var(--ink)]/90">
                {m.text}
              </span>
            </li>
          ))}
        </ul>
      </button>
    ) : null;

  const toggle = (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      aria-label={open ? "Hide public chat" : "Open public chat"}
      className="hud-chip inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold sm:px-3"
    >
      <ChatIcon />
      <span>{open ? "Hide" : "Chat"}</span>
      {!open && messages.length > 0 && (
        <span className="rounded bg-[var(--wash)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
          {messages.length}
        </span>
      )}
    </button>
  );

  return (
    <div
      className={`pointer-events-auto flex flex-col items-end gap-1.5 ${className}`}
    >
      {placement === "top" ? (
        <>
          {toggle}
          {collapsedPreview}
          {panel}
        </>
      ) : (
        <>
          {panel}
          {collapsedPreview}
          {toggle}
        </>
      )}
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
        <span className="truncate text-[10px] font-bold text-[var(--ink)]">
          {message.name}
        </span>
        <span className="shrink-0 font-mono text-[9px] tabular-nums text-[var(--ink-muted)]">
          {formatTime(message.t)}
        </span>
      </div>
      <p
        className={`mt-0.5 max-w-[95%] rounded px-2.5 py-1 text-[11px] leading-snug text-[var(--ink)] ${
          mine
            ? "rounded-br-sm bg-[color-mix(in_srgb,var(--field)_28%,var(--surface))]"
            : "rounded-bl-sm bg-[var(--wash)]"
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
