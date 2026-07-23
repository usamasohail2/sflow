"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PresencePeer } from "@/lib/presenceTypes";

const HEARTBEAT_MS = 15_000;
const CAMERA_PUSH_MS = 2_000;
const STORAGE_KEY = "isb-map-visitor-id";

export type MapCamera = { lat: number; lng: number };

function getVisitorId(): string {
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
  const visitorIdRef = useRef<string>("");
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
    const visitorId = visitorIdRef.current;
    if (!visitorId) return;
    try {
      const body: {
        visitorId: string;
        camera?: MapCamera;
      } = { visitorId };
      if (cameraRef.current) body.camera = cameraRef.current;

      const res = await fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      });
      if (!res.ok) return;
      const data = (await res.json()) as PresenceResponse;
      applySnapshot(data, visitorId);
      lastPushAt.current = Date.now();
    } catch {
      // ignore transient network errors
    }
  }, [applySnapshot]);

  const reportCamera = useCallback(
    (camera: MapCamera) => {
      if (!enabled) return;
      cameraRef.current = camera;
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

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    visitorIdRef.current = getVisitorId();

    const run = async () => {
      if (cancelled) return;
      await beat();
    };

    void run();
    const id = window.setInterval(() => {
      void run();
    }, HEARTBEAT_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      if (pendingTimer.current != null) {
        window.clearTimeout(pendingTimer.current);
        pendingTimer.current = null;
      }
    };
  }, [beat, enabled]);

  return {
    visitorId: visitorIdRef.current,
    viewers,
    peers,
    reportCamera,
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
