"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GameMap, type MarchAnim } from "@/components/GameMap";
import {
  HouseSprite,
  MillSprite,
  SoldierSprite,
  TurretSprite,
  VillagerSprite,
  WarehouseSprite,
  WellSprite,
} from "@/components/sprites";
import { ResourceGem } from "@/components/ResourceGem";
import type {
  BattleReport,
  BuildingType,
  GameSnapshot,
} from "@/lib/gameTypes";
import { SOLDIER_COST, buildingBonus } from "@/lib/gameTypes";
import { ringCentroid } from "@/lib/mapMath";

function BuildingThumb({
  type,
  className = "",
}: {
  type: BuildingType;
  className?: string;
}) {
  if (type === "mill") return <MillSprite className={className} />;
  if (type === "warehouse") return <WarehouseSprite className={className} />;
  if (type === "turret") return <TurretSprite className={className} />;
  return <WellSprite className={className} />;
}

export function PlayShell() {
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [displayGold, setDisplayGold] = useState(0);
  const [showMissions, setShowMissions] = useState(false);
  const [showRanks, setShowRanks] = useState(false);
  const [placing, setPlacing] = useState<BuildingType | null>(null);
  const [march, setMarch] = useState<MarchAnim | null>(null);

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
      setSelectedId(data.me?.homeSectorId || data.sectors[0]?.id || null);
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
    const map = new Map<string, { id: string; name: string }>();
    for (const p of snap?.players ?? []) {
      if (p.homeSectorId) {
        map.set(p.homeSectorId, { id: p.id, name: p.name });
      }
    }
    return map;
  }, [snap]);

  const gemsFound = useMemo(() => {
    if (!me) return 0;
    return me.discoveredSpotIds.filter((id) =>
      snap?.spots.some((s) => s.id === id && s.kind === "hidden")
    ).length;
  }, [me, snap]);

  const ranking = useMemo(() => {
    const rows = (snap?.players ?? [])
      .filter((p) => p.homeSectorId)
      .map((p) => ({
        id: p.id,
        name: p.name,
        sector:
          snap?.sectors.find((s) => s.id === p.homeSectorId)?.name ?? "—",
        farmed: p.totalFarmed,
      }))
      .sort((a, b) => b.farmed - a.farmed);
    return rows.slice(0, 10);
  }, [snap]);

  const missionList = useMemo(() => {
    if (!me) return [];
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
        label: "Roam zoomed-in until a resource spawns",
        done: gemsFound >= 1,
      },
      {
        id: "build",
        label: "Place your first building",
        done: me.buildings.length >= 1,
      },
      {
        id: "army",
        label: "Recruit a soldier",
        done: me.soldiers >= 1,
      },
    ];
  }, [me, gemsFound]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3400);
  };

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
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
        window.setTimeout(() => setError(null), 3200);
        return null;
      }
      setSnap(data as GameSnapshot);
      if (data.me) setDisplayGold(data.me.gold);
      return data;
    } catch {
      setError("Network error");
      window.setTimeout(() => setError(null), 3200);
      return null;
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
      if (!res.ok) return false;
      setSnap(data as GameSnapshot);
      if (data.me) setDisplayGold(data.me.gold);
      const gem = String(data.gem || "resource");
      showToast(
        data.bonus
          ? `${gem[0].toUpperCase()}${gem.slice(1)} found ahead! +${data.bonus}g`
          : "A resource appeared ahead!"
      );
      return true;
    } catch {
      return false;
    }
  };

  const placeBuilding = async (lat: number, lng: number) => {
    if (!placing) return;
    const data = await act("build", { buildingType: placing, lat, lng });
    if (data) {
      showToast("Building placed");
      setPlacing(null);
    }
    // On error keep placement mode so they can pick a clear spot
  };

  const launchAttack = async () => {
    if (!me?.house || !selected) return;
    const target = ringCentroid(selected.ring);
    setMarch({
      from: me.house,
      to: target,
      startedAt: Date.now(),
      durationMs: 3200,
    });
    const data = await act("attack", { sectorId: selected.id });
    window.setTimeout(() => setMarch(null), 3400);
    const battle = data?.battle as BattleReport | undefined;
    if (battle) {
      if (battle.win) {
        showToast(
          `Victory! ${battle.destroyed ? `${battle.destroyed} destroyed.` : ""} Lost ${battle.soldiersLost} soldier(s).`
        );
      } else {
        showToast(
          `Repelled! Their defense ${battle.defensePower} beat your ${battle.attackPower}. Army lost.`
        );
      }
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

  const missionsDone = missionList.filter((m) => m.done).length;

  const enemySelected =
    claimed &&
    selected &&
    selected.id !== me?.homeSectorId &&
    sectorOwner.has(selected.id);

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[var(--surface)]">
      {/* Full-bleed map */}
      <div className="absolute inset-0">
        <GameMap
          sectors={snap?.sectors ?? []}
          spots={snap?.spots ?? []}
          me={me}
          players={snap?.players ?? []}
          selectedId={selectedId}
          placingType={placing}
          march={march}
          onSelect={setSelectedId}
          onPlaceBuilding={(lat, lng) => void placeBuilding(lat, lng)}
          onSpawnFind={(p) => spawnFind(p)}
          onCollectHidden={(spotId) => void act("collect_hidden", { spotId }).then((d) => {
            if (d?.gained) showToast(`Collected +${d.gained} gold`);
          })}
          className="h-full w-full"
        />
      </div>

      {/* ---- Top bar ---- */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-start justify-between gap-2 p-2 sm:p-3">
        <div className="pointer-events-auto hud-chip px-3 py-1.5">
          <Link href="/" className="font-display text-xs text-[var(--ink)] sm:text-sm">
            Islamabad Territorial Wars
          </Link>
          <p className="font-mono text-[8px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
            {claimed ? `Home · ${homeName}` : "Pick your sector"}
          </p>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <div className="hud-chip px-3 py-1.5">
            <p className="hud-gold font-mono text-sm font-bold text-[#e8cf8a] sm:text-base">
              ⛃ {Math.floor(displayGold)}
            </p>
            {claimed && (
              <p className="text-right font-mono text-[8px] text-[var(--ink-faint)]">
                +{perTrip}/trip
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setShowRanks((v) => !v);
              setShowMissions(false);
            }}
            className="hud-chip px-3 py-1.5 font-mono text-[10px] text-[var(--ink-muted)] hover:text-[var(--sand)]"
          >
            🏆 Ranks
          </button>
          <button
            type="button"
            onClick={() => {
              setShowMissions((v) => !v);
              setShowRanks(false);
            }}
            className="hud-chip px-3 py-1.5 font-mono text-[10px] text-[var(--ink-muted)] hover:text-[var(--sand)]"
          >
            ◈ {missionsDone}/{missionList.length}
          </button>
          <Link
            href="/edit"
            className="hud-chip hidden px-3 py-1.5 font-mono text-[10px] text-[var(--ink-muted)] hover:text-[var(--sand)] sm:block"
          >
            Map editor
          </Link>
        </div>
      </div>

      {/* Ranks dropdown */}
      {showRanks && (
        <div className="absolute right-2 top-14 z-30 w-72 hud-panel p-3 sm:right-3">
          <h2 className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            Global sector ranking · resources farmed
          </h2>
          <ol className="mt-2 space-y-1">
            {ranking.length === 0 && (
              <li className="text-[11px] text-[var(--ink-faint)]">
                No sectors claimed yet
              </li>
            )}
            {ranking.map((r, i) => (
              <li
                key={r.id}
                className={`flex items-center justify-between text-[11px] ${
                  r.id === me?.id
                    ? "text-[var(--sand)]"
                    : "text-[var(--ink-muted)]"
                }`}
              >
                <span>
                  <span className="font-mono">
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
                  </span>{" "}
                  <strong>{r.sector}</strong>{" "}
                  <span className="text-[var(--ink-faint)]">· {r.name}</span>
                </span>
                <span className="font-mono">{r.farmed}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Missions dropdown */}
      {showMissions && (
        <div className="absolute right-2 top-14 z-30 w-64 hud-panel p-3 sm:right-3">
          <h2 className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            Missions
          </h2>
          <ul className="mt-2 space-y-1.5">
            {missionList.map((m) => (
              <li
                key={m.id}
                className={`flex items-start gap-2 text-[11px] ${
                  m.done
                    ? "text-[var(--field-bright)]"
                    : "text-[var(--ink-muted)]"
                }`}
              >
                <span className="mt-0.5 font-mono">{m.done ? "✔" : "•"}</span>
                <span>{m.label}</span>
              </li>
            ))}
          </ul>
          {me && (
            <button
              type="button"
              className="mt-3 w-full rounded-sm border border-[var(--line-strong)] px-2 py-1.5 text-left font-mono text-[9px] text-[var(--sand)]"
              onClick={() => {
                if (inviteLink) {
                  void navigator.clipboard.writeText(inviteLink);
                  showToast("Invite link copied — friend joins, you gain +1 villager");
                }
              }}
            >
              ⎘ Copy invite link (+1 villager)
            </button>
          )}
        </div>
      )}

      {/* Toast / error */}
      {(toast || error) && (
        <div className="pointer-events-none absolute left-1/2 top-14 z-40 -translate-x-1/2">
          <p
            className={`hud-chip px-4 py-2 text-xs font-semibold ${
              error ? "text-[var(--signal-bright)]" : "text-[var(--field-bright)]"
            }`}
          >
            {error || toast}
          </p>
        </div>
      )}

      {/* Placement cancel */}
      {placing && (
        <div className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 sm:bottom-8">
          <button
            type="button"
            onClick={() => setPlacing(null)}
            className="hud-chip px-4 py-2 text-xs font-semibold text-[var(--signal-bright)]"
          >
            ✕ Cancel placement
          </button>
        </div>
      )}

      {/* ---- Claim prompt (unclaimed) ---- */}
      {!claimed && selected && (
        <div className="absolute bottom-24 left-1/2 z-20 w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 sm:bottom-8">
          <div className="hud-panel p-4 text-center">
            <p className="font-display text-2xl text-[var(--ink)]">
              {selected.name}
            </p>
            <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
              {sectorOwner.has(selected.id)
                ? `Claimed by ${sectorOwner.get(selected.id)!.name}`
                : "Open territory — claim it forever. You start with a house and a villager."}
            </p>
            <button
              type="button"
              disabled={busy || !me || sectorOwner.has(selected.id)}
              onClick={() =>
                void act("claim_sector").then((d) => {
                  if (d) showToast("Sector claimed — house + villager ready");
                })
              }
              className="mt-3 w-full rounded-sm bg-[var(--signal)] px-3 py-2.5 text-sm font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.5)] disabled:opacity-40"
            >
              ⚑ Claim {selected.name}
            </button>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {(snap?.sectors ?? []).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={`rounded-sm border px-2 py-1 font-mono text-[9px] ${
                    s.id === selectedId
                      ? "border-[var(--sand)] text-[var(--sand)]"
                      : "border-[var(--line)] text-[var(--ink-muted)]"
                  }`}
                >
                  {s.name}
                  {sectorOwner.has(s.id) ? " ●" : ""}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ---- Attack panel: enemy sector selected ---- */}
      {enemySelected && !placing && (
        <div className="absolute bottom-24 left-1/2 z-20 w-[calc(100%-1.5rem)] max-w-xs -translate-x-1/2 sm:bottom-8">
          <div className="hud-panel p-3 text-center">
            <p className="font-display text-lg text-[var(--ink)]">
              {selected!.name}
            </p>
            <p className="text-[10px] text-[var(--ink-muted)]">
              Held by {sectorOwner.get(selected!.id)!.name}
            </p>
            <button
              type="button"
              disabled={busy || !me || me.soldiers <= 0 || Boolean(march)}
              onClick={() => void launchAttack()}
              className="mt-2 w-full rounded-sm bg-[var(--signal)] px-3 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              ⚔ Attack with {me?.soldiers ?? 0} soldier
              {(me?.soldiers ?? 0) === 1 ? "" : "s"}
            </button>
            {me && me.soldiers <= 0 && (
              <p className="mt-1 text-[9px] text-[var(--ink-faint)]">
                Recruit soldiers from the army panel first
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---- Bottom-left: village + army cameos ---- */}
      {claimed && me && (
        <div className="absolute bottom-2 left-2 z-20 sm:bottom-3 sm:left-3">
          <div className="hud-panel flex items-end gap-1.5 p-1.5 sm:gap-2 sm:p-2">
            <div className="cameo" title={`${me.villagers} villager(s) gathering`}>
              <VillagerSprite walking className="h-9 w-9" />
              <span className="cameo-badge">×{me.villagers}</span>
              <span className="cameo-label">Villager</span>
            </div>
            <div className="cameo" title="Your house">
              <HouseSprite className="h-9 w-10" />
              <span className="cameo-label">House</span>
            </div>
            <button
              type="button"
              className={`cameo ${
                displayGold >= SOLDIER_COST ? "cameo-blink" : ""
              }`}
              disabled={busy || displayGold < SOLDIER_COST}
              title={`Recruit soldier — ${SOLDIER_COST}g`}
              onClick={() =>
                void act("recruit_soldier").then((d) => {
                  if (d) showToast("Soldier recruited");
                })
              }
            >
              <SoldierSprite className="h-9 w-9" />
              {me.soldiers > 0 && (
                <span className="cameo-badge">×{me.soldiers}</span>
              )}
              <span className="cameo-cost">{SOLDIER_COST}g</span>
              <span className="cameo-label">Soldier</span>
            </button>
            {gemsFound > 0 && (
              <div className="cameo" title={`${gemsFound} resource site(s) found`}>
                <ResourceGem gem="diamond" size={26} pulse />
                <span className="cameo-badge">×{gemsFound}</span>
                <span className="cameo-label">Finds</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---- Bottom-right: build sidebar ---- */}
      {claimed && me && (
        <div className="absolute bottom-2 right-2 z-20 sm:bottom-3 sm:right-3">
          <div className="hud-panel p-1.5 sm:p-2">
            <p className="px-1 pb-1 text-center font-mono text-[8px] uppercase tracking-[0.24em] text-[var(--ink-faint)]">
              Build · tap then place
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {(snap?.buildingCatalog ?? []).map((b) => {
                const affordable = displayGold >= b.cost;
                const active = placing === b.type;
                return (
                  <button
                    key={b.type}
                    type="button"
                    className={`cameo ${active ? "cameo-active" : ""} ${
                      affordable && !active ? "cameo-blink" : ""
                    }`}
                    disabled={busy || !affordable}
                    title={`${b.name} — ${b.blurb} · ${b.footprintM}m ground`}
                    onClick={() =>
                      setPlacing((cur) => (cur === b.type ? null : b.type))
                    }
                  >
                    <BuildingThumb type={b.type} className="h-9 w-10" />
                    <span className="cameo-cost">{b.cost}g</span>
                    <span className="cameo-label">{b.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
