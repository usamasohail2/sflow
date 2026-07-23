"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import type { MapRef } from "react-map-gl/mapbox";
import { generateUsernameFromSeed } from "@/lib/usernames";

export interface LiveExplorer {
  id: string;
  name: string;
  lat?: number;
  lng?: number;
  color: number;
  lastSeen: number;
}

const HEARTBEAT_MS = 12_000;
const MOVE_THROTTLE_MS = 1_800;
const STORAGE_KEY = "isb-map-visitor-id";
const SHOW_KEY = "isb-map-show-explorers";

export const EXPLORER_PALETTES = [
  { shirt: "#0051FF", skin: "#f0c4a0", hair: "#2a2118" },
  { shirt: "#D94A00", skin: "#e8b890", hair: "#4a3428" },
  { shirt: "#0d9488", skin: "#f5d0b0", hair: "#1c1c1c" },
  { shirt: "#7c3aed", skin: "#d4a574", hair: "#3b2a1a" },
  { shirt: "#db2777", skin: "#f2c9a0", hair: "#5c4033" },
  { shirt: "#2563eb", skin: "#c68642", hair: "#111111" },
  { shirt: "#ea580c", skin: "#f1c27d", hair: "#6b4423" },
] as const;

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

function colorFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % EXPLORER_PALETTES.length;
}

export function useLivePresence(
  mapRef: React.RefObject<MapRef | null>,
  mapReady = false
) {
  const { data: session } = useSession();
  const [selfId, setSelfId] = useState("");
  const [viewers, setViewers] = useState<number | null>(null);
  const [explorers, setExplorers] = useState<LiveExplorer[]>([]);
  const [showExplorers, setShowExplorersState] = useState(true);
  const lastMoveSent = useRef(0);
  const nameRef = useRef("Explorer");
  const colorRef = useRef(0);

  useEffect(() => {
    const id = getVisitorId();
    setSelfId(id);
    colorRef.current = colorFromId(id);
    try {
      const stored = localStorage.getItem(SHOW_KEY);
      if (stored === "0") setShowExplorersState(false);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const fromSession = session?.user?.name?.trim().split(/\s+/)[0];
    if (fromSession) {
      nameRef.current = fromSession.slice(0, 24);
      return;
    }
    if (selfId) {
      nameRef.current = generateUsernameFromSeed(selfId);
    }
  }, [session?.user?.name, selfId]);

  const setShowExplorers = useCallback((next: boolean) => {
    setShowExplorersState(next);
    try {
      localStorage.setItem(SHOW_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

  const beat = useCallback(async (withPosition: boolean) => {
    if (!selfId) return;
    let lat: number | undefined;
    let lng: number | undefined;
    if (withPosition) {
      const map = mapRef.current;
      if (map) {
        const center = map.getCenter();
        lat = center.lat;
        lng = center.lng;
      }
    }

    try {
      const res = await fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitorId: selfId,
          name: nameRef.current,
          color: colorRef.current,
          lat,
          lng,
        }),
        keepalive: true,
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        viewers?: number;
        explorers?: LiveExplorer[];
      };
      if (typeof data.viewers === "number") {
        setViewers(Math.max(1, data.viewers));
      }
      if (Array.isArray(data.explorers)) {
        setExplorers(data.explorers);
      }
    } catch {
      // ignore transient network errors
    }
  }, [mapRef, selfId]);

  useEffect(() => {
    if (!selfId) return;
    let cancelled = false;

    const run = () => {
      if (!cancelled) void beat(true);
    };

    run();
    const id = window.setInterval(run, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [beat, selfId]);

  // Push position when the map camera moves
  useEffect(() => {
    if (!selfId || !mapReady) return;
    const map = mapRef.current?.getMap?.();
    if (!map) return;

    const onMove = () => {
      const now = Date.now();
      if (now - lastMoveSent.current < MOVE_THROTTLE_MS) return;
      lastMoveSent.current = now;
      void beat(true);
    };

    map.on("moveend", onMove);
    return () => {
      map.off("moveend", onMove);
    };
  }, [beat, mapRef, mapReady, selfId]);

  const others = useMemo(
    () =>
      explorers.filter(
        (e) =>
          e.id !== selfId &&
          typeof e.lat === "number" &&
          typeof e.lng === "number"
      ),
    [explorers, selfId]
  );

  return {
    selfId,
    viewers,
    explorers: others,
    showExplorers,
    setShowExplorers,
    selfColor: colorRef.current,
  };
}
