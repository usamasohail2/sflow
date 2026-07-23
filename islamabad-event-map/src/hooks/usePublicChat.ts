"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/presenceTypes";

const POLL_MS = 3_000;

type ChatResponse = {
  messages?: ChatMessage[];
  message?: ChatMessage;
  error?: string;
};

export function usePublicChat(opts: {
  enabled?: boolean;
  visitorId: string;
  displayName: string;
  onSent?: (text: string) => void;
}) {
  const { enabled = true, visitorId, displayName, onSent } = opts;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/chat", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as ChatResponse;
      if (Array.isArray(data.messages)) setMessages(data.messages);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await refresh();
    };
    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, refresh]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !visitorId || !displayName) return false;
      setSending(true);
      setError(null);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitorId,
            name: displayName,
            text: trimmed,
            website: "",
          }),
        });
        const data = (await res.json()) as ChatResponse;
        if (!res.ok) {
          setError(data.error || "Could not send");
          return false;
        }
        if (Array.isArray(data.messages)) setMessages(data.messages);
        onSentRef.current?.(trimmed);
        return true;
      } catch {
        setError("Could not send");
        return false;
      } finally {
        setSending(false);
      }
    },
    [visitorId, displayName]
  );

  return { messages, sending, error, send, refresh };
}
