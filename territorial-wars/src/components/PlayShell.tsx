"use client";

import Link from "next/link";
// import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GameMap } from "@/components/GameMap";
// import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import type {
  Player,
  Sector,
  SectorEconomy,
} from "@/lib/gameTypes";
import { RESOURCE_TICK_MS } from "@/lib/gameTypes";
import { pointInRing } from "@/lib/geo";

type PublicPlayer = {
  id: string;
  name: string;
  villagers: number;
  housesPlaced: number;
  houseSlots: number;
  activeSectorId: string | null;
};

type Snapshot = {
  sectors: Sector[];
  economies: Record<string, SectorEconomy>;
  players: PublicPlayer[];
  me: Player | null;
  serverNow: number;
};

function sectorCenter(sector: Sector): { lat: number; lng: number } {
  const ring = sector.ring.slice(0, -1);
  const lng =
    ring.reduce((s, p) => s + p[0], 0) / Math.max(1, ring.length);
  const lat =
    ring.reduce((s, p) => s + p[1], 0) / Math.max(1, ring.length);
  return { lat, lng };
}

export function PlayShell() {
  // Google sign-in temporarily disabled
  // const { data: session, status } = useSession();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteInput, setInviteInput] = useState("");
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    const invite =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("invite")
        : null;
    const q = invite ? `?invite=${encodeURIComponent(invite)}` : "";
    const res = await fetch(`/api/game${q}`);
    const data = (await res.json()) as Snapshot;
    setSnap(data);
    if (!selectedId && data.sectors[0]) {
      setSelectedId(data.me?.activeSectorId || data.sectors[0].id);
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), RESOURCE_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const liveEconomies = useMemo(() => {
    if (!snap) return {};
    const villagersBySector: Record<string, number> = {};
    for (const p of snap.players) {
      if (!p.activeSectorId) continue;
      villagersBySector[p.activeSectorId] =
        (villagersBySector[p.activeSectorId] ?? 0) + p.villagers;
    }
    const out: Record<string, SectorEconomy> = { ...snap.economies };
    const now = Date.now();
    for (const [sectorId, eco] of Object.entries(snap.economies)) {
      const count = villagersBySector[sectorId] ?? 0;
      if (count <= 0) {
        out[sectorId] = eco;
        continue;
      }
      const elapsed = Math.max(0, now - eco.lastTickAt);
      const ticks = Math.floor(elapsed / RESOURCE_TICK_MS);
      out[sectorId] = {
        ...eco,
        resources: eco.resources + ticks * count,
      };
    }
    void tick;
    return out;
  }, [snap, tick]);

  const selected = snap?.sectors.find((s) => s.id === selectedId) ?? null;
  const me = snap?.me ?? null;

  const insideSelected =
    selected && location ? pointInRing(location, selected.ring) : false;

  const useGps = () => {
    if (!navigator.geolocation) {
      setError("Geolocation not available — click the map to drop your pin.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setError(null);
      },
      () =>
        setError("GPS failed — click the map to place yourself for testing."),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const jumpIntoSector = (sector: Sector) => {
    setSelectedId(sector.id);
    setLocation(sectorCenter(sector));
    setError(null);
  };

  const act = async (action: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          sectorId: selectedId,
          lat: location?.lat,
          lng: location?.lng,
          invite: inviteInput || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Action failed");
      } else {
        await load();
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  const inviteLink =
    typeof window !== "undefined" && me?.inviteCode
      ? `${window.location.origin}/play?invite=${me.inviteCode}`
      : "";

  return (
    <main className="flex min-h-[100dvh] flex-col bg-[var(--surface)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 sm:px-6">
        <div>
          <Link href="/" className="font-display text-sm text-[var(--ink)] sm:text-base">
            Islamabad Territorial Wars
          </Link>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
            Dev mode · Google auth off
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/edit"
            className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-muted)]"
          >
            Edit sectors
          </Link>
          {/* Google sign-in commented out for now
          <GoogleSignInButton callbackUrl="/play" label="Google sign-in" />
          */}
          <span className="rounded-sm border border-[var(--sand)]/40 px-3 py-1.5 font-mono text-[10px] text-[var(--sand)]">
            Guest Dev
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_22rem]">
        <GameMap
          sectors={snap?.sectors ?? []}
          economies={liveEconomies}
          selectedId={selectedId}
          myLocation={location}
          onSelect={setSelectedId}
          onMapPlaceLocation={(lat, lng) => {
            setLocation({ lat, lng });
            setError(null);
          }}
          className="min-h-[50vh] lg:min-h-0 lg:h-full"
        />

        <aside className="space-y-4 border-t border-[var(--line)] bg-[var(--surface-raised)] p-5 lg:border-l lg:border-t-0">
          <div>
            <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              Your post
            </h2>
            {me ? (
              <ul className="mt-2 space-y-1 text-sm text-[var(--ink)]">
                <li>
                  Villagers: <strong>{me.villagers}</strong>
                </li>
                <li>
                  Houses:{" "}
                  <strong>
                    {me.housesPlaced}/{me.houseSlots}
                  </strong>
                </li>
                <li>
                  Stationed:{" "}
                  <strong>
                    {me.activeSectorId
                      ? snap?.sectors.find((s) => s.id === me.activeSectorId)
                          ?.name || me.activeSectorId
                      : "none"}
                  </strong>
                </li>
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[var(--ink-muted)]">Loading guest…</p>
            )}
          </div>

          {(snap?.sectors.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2">
              {snap!.sectors.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => jumpIntoSector(s)}
                  className="rounded-sm border border-[var(--line)] px-2.5 py-1.5 text-[11px] text-[var(--ink-muted)] hover:border-[var(--sand)] hover:text-[var(--sand)]"
                >
                  Jump into {s.name}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={useGps}
              className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs"
            >
              Use GPS
            </button>
            <span className="self-center font-mono text-[10px] text-[var(--ink-faint)]">
              or click map / Jump into
            </span>
          </div>

          {selected ? (
            <div className="space-y-2">
              <p className="font-display text-2xl text-[var(--ink)]">{selected.name}</p>
              <p className="text-sm text-[var(--ink-muted)]">
                Resources:{" "}
                <span className="text-[var(--sand)]">
                  {liveEconomies[selected.id]?.resources ?? 0}
                </span>
                <span className="text-[var(--ink-faint)]">
                  {" "}
                  · +1 / villager / 0.5s
                </span>
              </p>
              <p className="text-xs text-[var(--ink-faint)]">
                {location
                  ? insideSelected
                    ? "Your pin is inside this sector."
                    : "Your pin is outside this sector."
                  : "Set your location first (Jump into is easiest)."}
              </p>
              <button
                type="button"
                disabled={busy || !me}
                onClick={() => void act("join_sector")}
                className="w-full rounded-sm bg-[var(--signal)] px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                Station villagers here
              </button>
              <button
                type="button"
                disabled={busy || !me}
                onClick={() => void act("place_house")}
                className="w-full rounded-sm border border-[var(--sand)] px-3 py-2 text-sm text-[var(--sand)] disabled:opacity-40"
              >
                Place a house
              </button>
              {me?.activeSectorId === selected.id && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act("leave_sector")}
                  className="w-full rounded-sm border border-[var(--line)] px-3 py-2 text-xs text-[var(--ink-muted)]"
                >
                  Leave sector
                </button>
              )}
            </div>
          ) : (
            <p className="text-sm text-[var(--ink-muted)]">
              Select a territory on the map.
            </p>
          )}

          {me && (
            <div className="border-t border-[var(--line)] pt-4">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Invite (dev)
              </h3>
              <p className="mt-2 break-all font-mono text-[10px] text-[var(--sand)]">
                {inviteLink}
              </p>
              <label className="mt-3 block font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">
                Have a code?
                <input
                  value={inviteInput}
                  onChange={(e) => setInviteInput(e.target.value.toUpperCase())}
                  placeholder="CODE"
                  className="mt-1 w-full rounded-sm border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                />
              </label>
            </div>
          )}

          {error && (
            <p className="text-xs text-[var(--signal-bright)]">{error}</p>
          )}
        </aside>
      </div>
    </main>
  );
}
