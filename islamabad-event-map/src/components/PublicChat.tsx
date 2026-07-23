"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/hooks/usePublicChat";
import { EXPLORER_PALETTES } from "@/hooks/useLivePresence";

interface PublicChatProps {
  messages: ChatMessage[];
  selfId: string;
  displayName: string;
  sending: boolean;
  onSend: (text: string) => Promise<boolean>;
  className?: string;
}

export function PublicChat({
  messages,
  selfId,
  displayName,
  sending,
  onSend,
  className = "",
}: PublicChatProps) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, open]);

  const submit = async () => {
    const text = draft;
    if (!text.trim() || sending) return;
    const ok = await onSend(text);
    if (ok) {
      setDraft("");
      inputRef.current?.focus();
    }
  };

  return (
    <div
      className={`pointer-events-auto flex w-[min(100%,18.5rem)] flex-col overflow-hidden rounded-2xl border border-line bg-surface/95 shadow-[0_10px_30px_rgba(0,0,0,0.16)] backdrop-blur-md dark:bg-surface-raised/95 ${className}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="text-xs font-semibold text-ink">Public chat</span>
        <span className="text-[10px] font-medium text-ink-muted">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open && (
        <>
          <div
            ref={listRef}
            className="flex max-h-44 flex-col gap-1.5 overflow-y-auto px-2.5 py-2 sm:max-h-52"
          >
            {messages.length === 0 ? (
              <p className="px-1 py-3 text-center text-[11px] text-ink-faint">
                Say hi — messages float above explorers for 5s.
              </p>
            ) : (
              messages.map((msg) => {
                const mine = msg.visitorId === selfId;
                const palette =
                  EXPLORER_PALETTES[msg.color % EXPLORER_PALETTES.length]!;
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                  >
                    <span
                      className="mb-0.5 text-[9px] font-semibold"
                      style={{ color: palette.shirt }}
                    >
                      {mine ? "You" : msg.name}
                    </span>
                    <span
                      className={`max-w-[95%] rounded-2xl px-2.5 py-1 text-[11px] leading-snug ${
                        mine
                          ? "rounded-br-md bg-[var(--blue)] text-white"
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
            className="flex items-center gap-1.5 border-t border-line p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={160}
              placeholder={`Chat as ${displayName}…`}
              className="min-w-0 flex-1 rounded-full border border-line bg-wash px-3 py-1.5 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-[var(--blue)]"
              disabled={sending || !selfId}
            />
            <button
              type="submit"
              disabled={sending || !draft.trim() || !selfId}
              className="shrink-0 rounded-full bg-[var(--blue)] px-2.5 py-1.5 text-[11px] font-semibold text-white transition enabled:hover:opacity-90 disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}
