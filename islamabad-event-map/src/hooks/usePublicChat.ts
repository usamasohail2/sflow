"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/mapbox";

export interface ChatMessage {
  id: string;
  visitorId: string;
  name: string;
  text: string;
  color: number;
  lat?: number;
  lng?: number;
  createdAt: number;
}

export interface FloatingBubble {
  messageId: string;
  visitorId: string;
  text: string;
  lat: number;
  lng: number;
  expiresAt: number;
}

const POLL_MS = 2_000;
const BUBBLE_MS = 10_000;

function readEyePosition(
  mapRef: React.RefObject<MapRef | null>
): { lat: number; lng: number } | null {
  const map = mapRef.current;
  if (!map) return null;
  const center = map.getCenter();
  let eyeLat = center.lat;
  let eyeLng = center.lng;
  try {
    const camera = map.getFreeCameraOptions?.();
    const eye = camera?.position?.toLngLat?.();
    if (eye && Number.isFinite(eye.lat) && Number.isFinite(eye.lng)) {
      eyeLat = eye.lat;
      eyeLng = eye.lng;
    }
  } catch {
    // keep center
  }
  const mix = 0.35;
  return {
    lat: center.lat * (1 - mix) + eyeLat * mix,
    lng: center.lng * (1 - mix) + eyeLng * mix,
  };
}

export function usePublicChat({
  mapRef,
  selfId,
  displayName,
  selfColor,
  enabled = true,
}: {
  mapRef: React.RefObject<MapRef | null>;
  selfId: string;
  displayName: string;
  selfColor: number;
  enabled?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [floating, setFloating] = useState<FloatingBubble[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const seenIds = useRef(new Set<string>());
  const sinceRef = useRef(0);
  const bootstrapped = useRef(false);
  const sendingLock = useRef(false);

  const ingest = useCallback((incoming: ChatMessage[], isBootstrap: boolean) => {
    if (!incoming.length) return;

    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const msg of incoming) byId.set(msg.id, msg);
      return Array.from(byId.values())
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-80);
    });

    const newest = incoming.reduce(
      (max, m) => Math.max(max, m.createdAt),
      sinceRef.current
    );
    sinceRef.current = Math.max(sinceRef.current, newest);

    if (isBootstrap) {
      for (const msg of incoming) seenIds.current.add(msg.id);
      return;
    }

    const now = Date.now();
    const fresh = incoming.filter((m) => !seenIds.current.has(m.id));
    for (const msg of fresh) {
      seenIds.current.add(msg.id);
      if (typeof msg.lat !== "number" || typeof msg.lng !== "number") continue;
      setFloating((prev) => {
        const without = prev.filter((b) => b.visitorId !== msg.visitorId);
        return [
          ...without,
          {
            messageId: msg.id,
            visitorId: msg.visitorId,
            text: msg.text,
            lat: msg.lat!,
            lng: msg.lng!,
            expiresAt: now + BUBBLE_MS,
          },
        ];
      });
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const qs =
          bootstrapped.current && sinceRef.current
            ? `?since=${sinceRef.current}`
            : "";
        const res = await fetch(`/api/chat${qs}`);
        if (!res.ok) return;
        const data = (await res.json()) as { messages?: ChatMessage[] };
        if (cancelled || !Array.isArray(data.messages)) return;
        const isBootstrap = !bootstrapped.current;
        bootstrapped.current = true;
        ingest(data.messages, isBootstrap);
      } catch {
        // ignore
      }
    };

    void poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, ingest]);

  // Expire floating bubbles
  useEffect(() => {
    if (floating.length === 0) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setFloating((prev) => prev.filter((b) => b.expiresAt > now));
    }, 250);
    return () => window.clearInterval(id);
  }, [floating.length]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!selfId || sendingLock.current) return false;
      const trimmed = text.trim();
      if (!trimmed) return false;

      const pos = readEyePosition(mapRef);
      sendingLock.current = true;
      setSending(true);
      setSendError(null);

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitorId: selfId,
            name: displayName,
            color: selfColor,
            text: trimmed,
            lat: pos?.lat,
            lng: pos?.lng,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          setSendError("Couldn't send — try again");
          return false;
        }
        const data = (await res.json()) as {
          message?: ChatMessage;
          messages?: ChatMessage[];
        };
        if (Array.isArray(data.messages)) {
          ingest(data.messages, false);
        } else if (data.message) {
          ingest([data.message], false);
        }
        return true;
      } catch {
        setSendError("Couldn't send — check connection");
        return false;
      } finally {
        window.clearTimeout(timeout);
        sendingLock.current = false;
        setSending(false);
      }
    },
    [displayName, ingest, mapRef, selfColor, selfId]
  );

  return {
    messages,
    floating,
    sending,
    sendError,
    sendMessage,
  };
}
