"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GameMap } from "@/components/GameMap";
import { HouseSprite, VillagerSprite } from "@/components/sprites";
import type { Player, Sector, SectorEconomy } from "@/lib/gameTypes";
import { COSTS, RESOURCE_TICK_MS } from "@/lib/gameTypes";
import { pointInRing } from "@/lib/geo";

type PublicPlayer = {
  id: string;
  name: string;
  villagers: number;
  housesPlaced: number;
  houseSlots: number;
  gold: number;
  digBonus: number;
  activeSectorId: string | null;
  isBot?: boolean;
};

type Snapshot = {
  sectors: Sector[];
  economies: Record<string, SectorEconomy>;
  players: PublicPlayer[];
  me: Player | null;
  serverNow: number;
  costs?: typeof COSTS;
};

function sectorCenter(sector: Sector): { lat: number; lng: number } {
  const ring = sector.ring.slice(0, -1);
  const lng = ring.reduce((s, p) => s + p[0], 0) / Math.max(1, ring.length);
  const lat = ring.reduce((s, p) => s + p[1], 0) / Math.max(1, ring.length);
  return { lat, lng };
}

function goldPerTick(me: Player | null, controlling: boolean): number {
  if (!me?.activeSectorId) return 0;
  return me.villagers + me.digBonus + (controlling ? 1 : 0);
}

export function PlayShell() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [displayGold, setDisplayGold] = useState(0);

  const costs = snap?.costs ?? COSTS;

  const load = useCallback(async () => {
    const invite =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("invite")
        : null;
    const q = invite ? `?invite=${encodeURIComponent(invite)}` : "";
    const res = await fetch(`/api/game${q}`);
    const data = (await res.json()) as Snapshot;
    setSnap(data);
    if (data.me) setDisplayGold(data.me.gold);
    if (!selectedId && data.sectors[0]) {
      setSelectedId(data.me?.activeSectorId || data.sectors[0].id);
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), RESOURCE_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const me = snap?.me ?? null;
  const selected = snap?.sectors.find((s) => s.id === selectedId) ?? null;

  const controllingSelected =
    Boolean(me && selected && snap?.economies[selected.id]?.controllerId === me.id);

  // Live gold preview while digging
  useEffect(() => {
    if (!me?.activeSectorId) {
      if (me) setDisplayGold(me.gold);
      return;
    }
    const rate = goldPerTick(me, snap?.economies[me.activeSectorId]?.controllerId === me.id);
    setDisplayGold(me.gold);
    // tick bumps preview between server syncs
    void tick;
    const elapsed = Math.max(0, Date.now() - (snap?.serverNow ?? Date.now()));
    const ticks = Math.floor(elapsed / RESOURCE_TICK_MS);
    setDisplayGold(me.gold + ticks * rate);
  }, [me, snap, tick]);

  const presence = useMemo(() => {
    if (!snap) return [];
    const bySector: Record<string, { villagers: number; houses: number }> = {};
    for (const p of snap.players) {
      if (!p.activeSectorId) continue;
      const cur = bySector[p.activeSectorId] ?? { villagers: 0, houses: 0 };
      cur.villagers += p.villagers;
      cur.houses += p.housesPlaced;
      bySector[p.activeSectorId] = cur;
    }
    return Object.entries(bySector).map(([sectorId, v]) => ({
      sectorId,
      villagers: v.villagers,
      houses: v.houses,
    }));
  }, [snap]);

  const leaderboard = useMemo(() => {
    if (!snap) return [];
    return [...snap.players]
      .filter((p) => !p.isBot || p.gold > 0)
      .sort((a, b) => b.gold - a.gold)
      .slice(0, 6);
  }, [snap]);

  const missions = useMemo(() => {
    if (!me) return [];
    return [
      {
        id: "station",
        label: "Station a villager in a sector",
        done: Boolean(me.activeSectorId),
      },
      {
        id: "house",
        label: `Build a house (${costs.house} gold)`,
        done: me.housesPlaced >= 1,
      },
      {
        id: "recruit",
        label: `Recruit a 2nd villager (${costs.villager} gold)`,
        done: me.villagers >= 2,
      },
      {
        id: "control",
        label: "Control a sector (most villagers there)",
        done: Object.values(snap?.economies ?? {}).some(
          (e) => e.controllerId === me.id
        ),
      },
      {
        id: "rich",
        label: "Bank 100 gold",
        done: me.gold >= 100,
      },
    ];
  }, [me, snap, costs]);

  const insideSelected =
    selected && location ? pointInRing(location, selected.ring) : false;

  const digRate = goldPerTick(
    me,
    Boolean(me?.activeSectorId && snap?.economies[me.activeSectorId]?.controllerId === me.id)
  );

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
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
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Action failed");
      } else {
        await load();
        if (action === "join_sector") showToast("Villagers stationed — they dig!");
        if (action === "build_house") showToast("House built — can shelter more villagers");
        if (action === "recruit_villager") showToast("New villager joined the dig");
        if (action === "upgrade_dig") showToast("Better tools — +1 gold per tick");
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  const jumpIntoSector = (sector: Sector) => {
    setSelectedId(sector.id);
    setLocation(sectorCenter(sector));
    setError(null);
  };

  const inviteLink =
    typeof window !== "undefined" && me?.inviteCode
      ? `${window.location.origin}/play?invite=${me.inviteCode}`
      : "";

  const controllerName = (sectorId: string) => {
    const cid = snap?.economies[sectorId]?.controllerId;
    if (!cid) return "Contested / empty";
    return snap?.players.find((p) => p.id === cid)?.name ?? "Unknown";
  };

  return (
    <main className="flex min-h-[100dvh] flex-col bg-[var(--surface)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 sm:px-6">
        <div>
          <Link href="/" className="font-display text-sm text-[var(--ink)] sm:text-base">
            Islamabad Territorial Wars
          </Link>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
            Dig · build · control
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-sm border border-[var(--sand)]/50 bg-[var(--wash)] px-3 py-1.5 font-mono text-xs text-[var(--sand)]">
            {Math.floor(displayGold)} gold
            {me?.activeSectorId ? (
              <span className="text-[var(--ink-faint)]"> · +{digRate}/tick</span>
            ) : null}
          </div>
          <Link
            href="/edit"
            className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-muted)]"
          >
            Edit map
          </Link>
          <span className="hidden rounded-sm border border-[var(--line)] px-3 py-1.5 font-mono text-[10px] text-[var(--ink-faint)] sm:inline">
            {me?.name ?? "…"}
          </span>
        </div>
      </header>

      {toast && (
        <div className="border-b border-[var(--field)]/40 bg-[var(--field)]/15 px-4 py-2 text-center text-xs text-[var(--field-bright)]">
          {toast}
        </div>
      )}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_24rem]">
        <GameMap
          sectors={snap?.sectors ?? []}
          economies={snap?.economies ?? {}}
          presence={presence}
          selectedId={selectedId}
          myLocation={location}
          onSelect={setSelectedId}
          onMapPlaceLocation={(lat, lng) => {
            setLocation({ lat, lng });
            setError(null);
          }}
          className="min-h-[45vh] lg:min-h-0 lg:h-full"
        />

        <aside className="max-h-[55vh] space-y-4 overflow-y-auto border-t border-[var(--line)] bg-[var(--surface-raised)] p-4 lg:max-h-none lg:border-l lg:border-t-0 lg:p-5">
          {/* Missions */}
          <section>
            <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              Missions
            </h2>
            <ul className="mt-2 space-y-1.5">
              {missions.map((m) => (
                <li
                  key={m.id}
                  className={`flex items-start gap-2 text-xs ${
                    m.done ? "text-[var(--field-bright)]" : "text-[var(--ink-muted)]"
                  }`}
                >
                  <span className="mt-0.5 font-mono">{m.done ? "[x]" : "[ ]"}</span>
                  <span>{m.label}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Camp */}
          <section className="border-t border-[var(--line)] pt-4">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              Your camp
            </h2>
            <div className="mt-2 flex items-end gap-2">
              <VillagerSprite digging={Boolean(me?.activeSectorId)} className="h-12 w-12" />
              <HouseSprite className="h-11 w-12" />
            </div>
            {me && (
              <ul className="mt-2 space-y-1 text-sm text-[var(--ink)]">
                <li>
                  Villagers <strong>{me.villagers}</strong>
                  <span className="text-[var(--ink-faint)]">
                    {" "}
                    / {me.housesPlaced + 1} beds
                  </span>
                </li>
                <li>
                  Houses{" "}
                  <strong>
                    {me.housesPlaced}/{me.houseSlots}
                  </strong>
                </li>
                <li>
                  Tools <strong>+{me.digBonus}</strong>
                </li>
              </ul>
            )}
          </section>

          {/* Quick jump */}
          {(snap?.sectors.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2">
              {snap!.sectors.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => jumpIntoSector(s)}
                  className="rounded-sm border border-[var(--line)] px-2.5 py-1.5 text-[11px] text-[var(--ink-muted)] hover:border-[var(--sand)] hover:text-[var(--sand)]"
                >
                  Go to {s.name}
                </button>
              ))}
            </div>
          )}

          {/* Selected sector */}
          {selected ? (
            <section className="space-y-2 border-t border-[var(--line)] pt-4">
              <p className="font-display text-2xl text-[var(--ink)]">{selected.name}</p>
              <p className="text-xs text-[var(--ink-muted)]">
                Controlled by{" "}
                <span className="text-[var(--sand)]">{controllerName(selected.id)}</span>
                {controllingSelected ? " (you)" : ""}
              </p>
              <p className="text-xs text-[var(--ink-faint)]">
                Dig strength here: {snap?.economies[selected.id]?.dugTotal ?? 0}
              </p>
              <p className="text-xs text-[var(--ink-faint)]">
                {location
                  ? insideSelected
                    ? "Pin is inside — you can station here."
                    : "Pin is outside — tap inside the sector."
                  : "Tap the map inside a sector to drop your pin."}
              </p>
              <button
                type="button"
                disabled={busy || !me}
                onClick={() => void act("join_sector")}
                className="w-full rounded-sm bg-[var(--signal)] px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {me?.activeSectorId === selected.id
                  ? "Already stationed here"
                  : "Station villagers"}
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
            </section>
          ) : null}

          {/* Shop */}
          <section className="space-y-2 border-t border-[var(--line)] pt-4">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              Spend gold
            </h2>
            <p className="text-[11px] leading-relaxed text-[var(--ink-faint)]">
              Dig while stationed. Control a sector (most villagers) for +1 gold
              per tick. Houses shelter extra villagers.
            </p>
            <button
              type="button"
              disabled={busy || !me}
              onClick={() => void act("build_house")}
              className="flex w-full items-center justify-between rounded-sm border border-[var(--sand)]/60 px-3 py-2 text-left text-sm text-[var(--sand)] disabled:opacity-40"
            >
              <span>Build house</span>
              <span className="font-mono text-xs">{costs.house}g</span>
            </button>
            <button
              type="button"
              disabled={busy || !me}
              onClick={() => void act("recruit_villager")}
              className="flex w-full items-center justify-between rounded-sm border border-[var(--field-bright)]/50 px-3 py-2 text-left text-sm text-[var(--field-bright)] disabled:opacity-40"
            >
              <span>Recruit villager</span>
              <span className="font-mono text-xs">{costs.villager}g</span>
            </button>
            <button
              type="button"
              disabled={busy || !me}
              onClick={() => void act("upgrade_dig")}
              className="flex w-full items-center justify-between rounded-sm border border-[var(--line)] px-3 py-2 text-left text-sm text-[var(--ink-muted)] disabled:opacity-40"
            >
              <span>Upgrade tools (+1/tick)</span>
              <span className="font-mono text-xs">{costs.digBonus}g</span>
            </button>
          </section>

          {/* Leaderboard */}
          <section className="border-t border-[var(--line)] pt-4">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              Strongest settlers
            </h2>
            <ol className="mt-2 space-y-1">
              {leaderboard.map((p, i) => (
                <li
                  key={p.id}
                  className={`flex justify-between text-xs ${
                    p.id === me?.id ? "text-[var(--sand)]" : "text-[var(--ink-muted)]"
                  }`}
                >
                  <span>
                    {i + 1}. {p.name}
                    {p.isBot ? " (rival)" : ""}
                  </span>
                  <span className="font-mono">{p.gold}g</span>
                </li>
              ))}
            </ol>
          </section>

          {me && (
            <section className="border-t border-[var(--line)] pt-4">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Invite friend
              </h3>
              <p className="mt-1 text-[11px] text-[var(--ink-faint)]">
                They join → you get +1 villager, +1 house plot, +15 gold.
              </p>
              <button
                type="button"
                className="mt-2 break-all text-left font-mono text-[10px] text-[var(--sand)] underline"
                onClick={() => {
                  if (inviteLink) {
                    void navigator.clipboard.writeText(inviteLink);
                    showToast("Invite link copied");
                  }
                }}
              >
                {inviteLink || "…"}
              </button>
            </section>
          )}

          {error && (
            <p className="text-xs text-[var(--signal-bright)]">{error}</p>
          )}
        </aside>
      </div>
    </main>
  );
}
