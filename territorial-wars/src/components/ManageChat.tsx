"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage } from "@/lib/presenceTypes";
import { usePublicChat } from "@/hooks/usePublicChat";

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

type Props = {
  visitorId: string;
  displayName: string;
};

/** Always-open full chat for the manage dashboard */
export function ManageChat({ visitorId, displayName }: Props) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const { messages, sending, error, send } = usePublicChat({
    enabled: Boolean(visitorId),
    visitorId,
    displayName,
  });

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await send(draft);
    if (ok) setDraft("");
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-sm border border-[var(--line)] bg-[var(--wash)]">
      <div className="border-b border-[var(--line)] px-3 py-2.5">
        <h2 className="font-display text-lg text-[var(--ink)]">Chat</h2>
        <p className="text-[12px] text-[var(--ink-muted)]">
          What everyone is saying right now
        </p>
      </div>

      <div
        ref={listRef}
        className="flex max-h-[min(28rem,55dvh)] min-h-[16rem] flex-col gap-2.5 overflow-y-auto px-3 py-3"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-[var(--ink-faint)]">
            Nobody has said anything yet. You can say hi!
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
        className="flex items-center gap-2 border-t border-[var(--line)] px-3 py-2.5"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={140}
          placeholder="Type a message…"
          className="min-w-0 flex-1 rounded-sm border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--sand)]"
          aria-label="Chat message"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="shrink-0 rounded-sm bg-[var(--signal)] px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>
      {error && (
        <p className="px-3 pb-2 text-[12px] text-[var(--signal-bright)]">
          {error}
        </p>
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
        <span className="truncate text-[12px] font-bold text-[var(--ink)]">
          {mine ? "You" : message.name}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--ink-faint)]">
          {formatTime(message.t)}
        </span>
      </div>
      <p
        className={`mt-0.5 max-w-[95%] rounded-sm px-3 py-1.5 text-[13px] leading-snug text-[var(--ink)] ${
          mine
            ? "bg-[color-mix(in_srgb,var(--field)_28%,var(--surface))]"
            : "bg-[var(--surface)]"
        }`}
      >
        {message.text}
      </p>
    </div>
  );
}
