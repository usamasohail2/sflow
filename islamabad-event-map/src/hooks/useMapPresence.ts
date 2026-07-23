"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PresencePeer } from "@/lib/presenceTypes";
import { generateUsername } from "@/lib/usernames";

const HEARTBEAT_MS = 15_000;
const CAMERA_PUSH_MS = 2_000;
const BUBBLE_MS = 45_000;
const STORAGE_KEY = "isb-map-visitor-id";
const NAME_KEY = "isb-map-visitor-name";

export type MapCamera = { lat: number; lng: number };

export function getVisitorId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "")
        : `v_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return `v_${Math.random().toString(36).slice(2)}`;
  }
}

export function getVisitorName(): string {
  try {
    const existing = localStorage.getItem(NAME_KEY)?.trim();
    if (existing) return existing;
    const name = generateUsername();
    localStorage.setItem(NAME_KEY, name);
    return name;
  } catch {
    return generateUsername();
  }
}

export function setVisitorName(name: string) {
  const trimmed = name.trim().slice(0, 32);
  if (trimmed.length < 2) return;
  try {
    localStorage.setItem(NAME_KEY, trimmed);
  } catch {
    // ignore
  }
}

type PresenceResponse = {
  viewers?: number;
  peers?: PresencePeer[];
};

/**
 * Live map presence: heartbeat + throttled camera-center reports.
 * Peers exclude the local visitor.
 */
export function useMapPresence(enabled = true) {
  const [viewers, setViewers] = useState<number | null>(null);
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [visitorId, setVisitorId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [selfCamera, setSelfCamera] = useState<MapCamera | null>(null);
  const [selfBubble, setSelfBubble] = useState<{
    text: string;
    at: number;
  } | null>(null);
  const visitorIdRef = useRef("");
  const nameRef = useRef("");
  const cameraRef = useRef<MapCamera | null>(null);
  const lastPushAt = useRef(0);
  const pendingTimer = useRef<number | null>(null);

  const applySnapshot = useCallback((data: PresenceResponse, selfId: string) => {
    if (typeof data.viewers === "number") {
      setViewers(Math.max(1, data.viewers));
    }
    const next = Array.isArray(data.peers)
      ? data.peers.filter(
          (p) =>
            p.id !== selfId &&
            typeof p.lat === "number" &&
            typeof p.lng === "number" &&
            Number.isFinite(p.lat) &&
            Number.isFinite(p.lng)
        )
      : [];
    setPeers(next);
  }, []);

  const beat = useCallback(async () => {
    const id = visitorIdRef.current;
    if (!id) return;
    try {
      const body: {
        visitorId: string;
        name?: string;
        camera?: MapCamera;
      } = { visitorId: id };
      if (nameRef.current) body.name = nameRef.current;
      if (cameraRef.current) body.camera = cameraRef.current;

      const res = await fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      });
      if (!res.ok) return;
      const data = (await res.json()) as PresenceResponse;
      applySnapshot(data, id);
      lastPushAt.current = Date.now();
    } catch {
      // ignore transient network errors
    }
  }, [applySnapshot]);

  const reportCamera = useCallback(
    (camera: MapCamera) => {
      if (!enabled) return;
      cameraRef.current = camera;
      setSelfCamera(camera);
      const elapsed = Date.now() - lastPushAt.current;
      if (elapsed >= CAMERA_PUSH_MS) {
        void beat();
        return;
      }
      if (pendingTimer.current != null) return;
      pendingTimer.current = window.setTimeout(() => {
        pendingTimer.current = null;
        void beat();
      }, CAMERA_PUSH_MS - elapsed);
    },
    [beat, enabled]
  );

  const noteLocalMessage = useCallback((text: string) => {
    setSelfBubble({ text, at: Date.now() });
  }, []);

  const rename = useCallback(
    (name: string) => {
      const trimmed = name.trim().slice(0, 32);
      if (trimmed.length < 2) return;
      setVisitorName(trimmed);
      nameRef.current = trimmed;
      setDisplayName(trimmed);
      void beat();
    },
    [beat]
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const id = getVisitorId();
    const name = getVisitorName();
    visitorIdRef.current = id;
    nameRef.current = name;
    setVisitorId(id);
    setDisplayName(name);

    const run = async () => {
      if (cancelled) return;
      await beat();
    };

    void run();
    const interval = window.setInterval(() => {
      void run();
    }, HEARTBEAT_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      if (pendingTimer.current != null) {
        window.clearTimeout(pendingTimer.current);
        pendingTimer.current = null;
      }
    };
  }, [beat, enabled]);

  // Drop expired local bubble
  useEffect(() => {
    if (!selfBubble) return;
    const left = BUBBLE_MS - (Date.now() - selfBubble.at);
    if (left <= 0) {
      setSelfBubble(null);
      return;
    }
    const t = window.setTimeout(() => setSelfBubble(null), left);
    return () => window.clearTimeout(t);
  }, [selfBubble]);

  const peersWithFreshBubbles = peers.map((p) => {
    if (
      p.lastMessage &&
      p.lastMessageAt &&
      Date.now() - p.lastMessageAt <= BUBBLE_MS
    ) {
      return p;
    }
    return { ...p, lastMessage: undefined, lastMessageAt: undefined };
  });

  return {
    visitorId,
    displayName,
    viewers,
    peers: peersWithFreshBubbles,
    selfCamera,
    selfBubble,
    reportCamera,
    noteLocalMessage,
    rename,
  };
}

/** Deterministic ~10–30 m offset so stacked cameras don't fully overlap. */
export function cameraMarkerJitter(id: string): { lat: number; lng: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const angle = ((h >>> 0) % 360) * (Math.PI / 180);
  const radius = 0.00012 + ((h >>> 8) % 120) / 1_000_000;
  return {
    lat: Math.sin(angle) * radius,
    lng: Math.cos(angle) * radius,
  };
}

export const CHAT_BUBBLE_MS = BUBBLE_MS;
