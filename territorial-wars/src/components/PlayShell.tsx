"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GameMap } from "@/components/GameMap";
import { HouseSprite, VillagerSprite } from "@/components/sprites";
import type { GameSnapshot, BuildingType } from "@/lib/gameTypes";
import { buildingBonus } from "@/lib/gameTypes";

export function PlayShell() {
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [displayGold, setDisplayGold] = useState(0);

  const load = useCallback(async () => {
    const invite =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("invite")
        : null;
    const q = invite ? `?invite=${encodeURIComponent(invite)}` : "";
    const res = await fetch(`/api/game${q}`);
    const data = (await res.json()) as GameSnapshot;
    setSnap(data);
    if (data.me) setDisplayGold(data.me.gold);
    if (!selectedId) {
      setSelectedId(
        data.me?.homeSectorId || data.sectors[0]?.id || null
      );
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(id);
  }, [load]);

  // Smooth gold preview between syncs
  useEffect(() => {
    if (!snap?.me?.homeSectorId) {
      if (snap?.me) setDisplayGold(snap.me.gold);
      return;
    }
    const me = snap.me;
    const tripMs = snap.gatherTripMs;
    const easyYield = snap.spots
      .filter((s) => s.sectorId === me.homeSectorId && s.kind === "easy")
      .reduce((n, s) => n + s.yield, 0);
    const perTrip =
      me.villagers * (Math.max(1, easyYield) + buildingBonus(me.buildings));

    const tick = () => {
      const elapsed = Math.max(0, Date.now() - me.lastGatherAt);
      const trips = Math.floor(elapsed / tripMs);
      setDisplayGold(me.gold + trips * perTrip);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [snap]);

  const me = snap?.me ?? null;
  const selected = snap?.sectors.find((s) => s.id === selectedId) ?? null;
  const claimed = Boolean(me?.homeSectorId);
  const homeName =
    snap?.sectors.find((s) => s.id === me?.homeSectorId)?.name ?? null;

  const sectorOwner = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of snap?.players ?? []) {
      if (p.homeSectorId) map.set(p.homeSectorId, p.name);
    }
    return map;
  }, [snap]);

  const missionList = useMemo(() => {
    if (!me) return [];
    const hiddenFound = me.discoveredSpotIds.filter((id) =>
      snap?.spots.some((s) => s.id === id && s.kind === "hidden")
    ).length;
    return [
      {
        id: "claim",
        label: "Claim one sector forever",
        done: Boolean(me.homeSectorId),
      },
      {
        id: "watch",
        label: "Earn gold from automatic gathering",
        done: me.gold > 0,
      },
      {
        id: "explore",
        label: "Roam zoomed-in until a gem spawns ahead",
        done: hiddenFound >= 1,
      },
      {
        id: "build",
        label: "Build your first structure",
        done: me.buildings.length >= 1,
      },
    ];
  }, [me, snap]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  };

  const act = async (
    action: string,
    extra: Record<string, unknown> = {}
  ) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sectorId: selectedId, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Action failed");
      } else {
        setSnap(data as GameSnapshot);
        if (data.me) setDisplayGold(data.me.gold);
        if (action === "claim_sector") {
          showToast("Sector claimed — house + villager ready");
        }
        if (action === "spawn_find") {
          const gem = String(data.gem || "Gem");
          showToast(
            data.bonus
              ? `${gem[0].toUpperCase()}${gem.slice(1)} found! +${data.bonus} gold`
              : `${gem} found ahead!`
          );
        }
        if (action === "collect_hidden") {
          showToast(
            data.gained ? `Collected +${data.gained} gold` : "Collected"
          );
        }
        if (action === "build") showToast("Building raised");
      }
    } catch {
      if (action !== "spawn_find") setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  const spawnFind = async (payload: {
    lat: number;
    lng: number;
    bearing: number;
    zoom: number;
    roamMeters: number;
    exploreMs: number;
  }): Promise<boolean> => {
    try {
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "spawn_find", ...payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Soft fail while roaming — don't spam the error panel
        return false;
      }
      setSnap(data as GameSnapshot);
      if (data.me) setDisplayGold(data.me.gold);
      const gem = String(data.gem || "gem");
      showToast(
        data.bonus
          ? `${gem[0].toUpperCase()}${gem.slice(1)} sparkles ahead! +${data.bonus}g`
          : "A gem appeared ahead!"
      );
      return true;
    } catch {
      return false;
    }
  };

  const inviteLink =
    typeof window !== "undefined" && me?.inviteCode
      ? `${window.location.origin}/play?invite=${me.inviteCode}`
      : "";

  const perTrip =
    me?.homeSectorId && snap
      ? me.villagers *
        (Math.max(
          1,
          snap.spots
            .filter(
              (s) => s.sectorId === me.homeSectorId && s.kind === "easy"
            )
            .reduce((n, s) => n + s.yield, 0)
        ) +
          buildingBonus(me.buildings))
      : 0;

  return (
    <main className="flex min-h-[100dvh] flex-col bg-[var(--surface)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 sm:px-6">
        <div>
          <Link
            href="/"
            className="font-display text-sm text-[var(--ink)] sm:text-base"
          >
            Islamabad Territorial Wars
          </Link>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
            Claim · gather · build
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-sm border border-[var(--sand)]/50 bg-[var(--wash)] px-3 py-1.5 font-mono text-xs text-[var(--sand)]">
            {Math.floor(displayGold)} gold
            {claimed ? (
              <span className="text-[var(--ink-faint)]">
                {" "}
                · +{perTrip}/trip
              </span>
            ) : null}
          </div>
          <Link
            href="/edit"
            className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-muted)]"
          >
            Draw sectors
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
          spots={snap?.spots ?? []}
          me={me}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onSpawnFind={(p) => spawnFind(p)} // returns success boolean
          onCollectHidden={(spotId) => void act("collect_hidden", { spotId })}
          className="min-h-[45vh] lg:min-h-0 lg:h-full"
        />

        <aside className="max-h-[55vh] space-y-4 overflow-y-auto border-t border-[var(--line)] bg-[var(--surface-raised)] p-4 lg:max-h-none lg:border-l lg:border-t-0 lg:p-5">
          <section>
            <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              Missions
            </h2>
            <ul className="mt-2 space-y-1.5">
              {missionList.map((m) => (
                <li
                  key={m.id}
                  className={`flex items-start gap-2 text-xs ${
                    m.done
                      ? "text-[var(--field-bright)]"
                      : "text-[var(--ink-muted)]"
                  }`}
                >
                  <span className="mt-0.5 font-mono">
                    {m.done ? "[x]" : "[ ]"}
                  </span>
                  <span>{m.label}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="border-t border-[var(--line)] pt-4">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              Your village
            </h2>
            <div className="mt-2 flex items-end gap-2">
              <VillagerSprite walking={claimed} className="h-12 w-12" />
              <HouseSprite className="h-11 w-12" />
            </div>
            {me && (
              <ul className="mt-2 space-y-1 text-sm text-[var(--ink)]">
                <li>
                  Home{" "}
                  <strong>{homeName ?? "— pick a sector"}</strong>
                </li>
                <li>
                  Villagers <strong>{me.villagers}</strong>
                </li>
                <li>
                  Buildings <strong>{me.buildings.length}</strong>
                </li>
              </ul>
            )}
          </section>

          {!claimed && selected && (
            <section className="space-y-2 border-t border-[var(--line)] pt-4">
              <p className="font-display text-2xl text-[var(--ink)]">
                {selected.name}
              </p>
              <p className="text-xs text-[var(--ink-muted)]">
                {sectorOwner.has(selected.id)
                  ? `Claimed by ${sectorOwner.get(selected.id)}`
                  : "Open — claim it forever. You start with one house and one villager."}
              </p>
              <button
                type="button"
                disabled={busy || !me || sectorOwner.has(selected.id)}
                onClick={() => void act("claim_sector")}
                className="w-full rounded-sm bg-[var(--signal)] px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                Claim {selected.name}
              </button>
            </section>
          )}

          {claimed && (
            <section className="space-y-2 border-t border-[var(--line)] pt-4">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                Build
              </h2>
              <p className="text-[11px] leading-relaxed text-[var(--ink-faint)]">
                Villagers gather on their own. Zoom fully into {homeName} and
                roam — diamonds and gems spawn ahead of you as you explore.
              </p>
              {(snap?.buildingCatalog ?? []).map((b) => {
                const owned = me?.buildings.some((x) => x.type === b.type);
                return (
                  <button
                    key={b.type}
                    type="button"
                    disabled={busy || !me || owned}
                    onClick={() =>
                      void act("build", {
                        buildingType: b.type as BuildingType,
                      })
                    }
                    className="flex w-full items-center justify-between rounded-sm border border-[var(--sand)]/50 px-3 py-2 text-left text-sm text-[var(--sand)] disabled:opacity-40"
                  >
                    <span>
                      {b.name}
                      <span className="mt-0.5 block text-[10px] text-[var(--ink-faint)]">
                        {owned ? "Built" : b.blurb}
                      </span>
                    </span>
                    <span className="font-mono text-xs">{b.cost}g</span>
                  </button>
                );
              })}
            </section>
          )}

          {(snap?.sectors.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
              {snap!.sectors.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={`rounded-sm border px-2.5 py-1.5 text-[11px] ${
                    s.id === selectedId
                      ? "border-[var(--sand)] text-[var(--sand)]"
                      : "border-[var(--line)] text-[var(--ink-muted)]"
                  }`}
                >
                  {s.name}
                  {s.id === me?.homeSectorId ? " ★" : ""}
                </button>
              ))}
            </div>
          )}

          {me && (
            <section className="border-t border-[var(--line)] pt-4">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Invite friend
              </h3>
              <p className="mt-1 text-[11px] text-[var(--ink-faint)]">
                When they join with your link, you get +1 villager.
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
