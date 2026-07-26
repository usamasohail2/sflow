"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import {
  formatGoldCompact,
  GOLD_COIN,
  type GameSnapshot,
  type PublicPlayer,
  type SectorStatsPoint,
} from "@/lib/gameTypes";
import { mappedSectorAnalytics } from "@/lib/sectorAnalytics";

const DAY = 24 * 60 * 60 * 1000;

function inLast(ts: number, windowMs: number, now: number): boolean {
  return ts > 0 && now - ts <= windowMs;
}

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      className="rounded-sm border border-[var(--line)] bg-[var(--wash)] px-3 py-2.5"
      title={hint}
    >
      <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--ink)]">
        {value}
      </div>
    </div>
  );
}

function MiniBars({
  items,
  empty,
}: {
  items: { id: string; label: string; value: number; color?: string }[];
  empty: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) {
    return <p className="text-[12px] text-[var(--ink-faint)]">{empty}</p>;
  }
  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-[11px] text-[var(--ink-muted)]">
            {item.label}
          </span>
          <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-black/35">
            <div
              className="h-full rounded-sm"
              style={{
                width: `${Math.max(4, (item.value / max) * 100)}%`,
                background: item.color || "#e8cf8a",
              }}
            />
          </div>
          <span className="w-12 shrink-0 text-right font-mono text-[10px] text-[#e8cf8a]">
            {formatGoldCompact(item.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function GrowthSpark({ history }: { history: SectorStatsPoint[] }) {
  const w = 280;
  const h = 72;
  const pad = 6;
  if (history.length === 0) {
    return (
      <p className="py-4 text-center text-[11px] text-[var(--ink-faint)]">
        No samples yet
      </p>
    );
  }
  const series = history;
  const maxF = Math.max(1, ...series.map((p) => p.farmed));
  const t0 = series[0]!.ts;
  const t1 = series[series.length - 1]!.ts;
  const span = Math.max(1, t1 - t0);
  const d = series
    .map((p, i) => {
      const x = pad + ((p.ts - t0) / span) * (w - pad * 2);
      const y = pad + (h - pad * 2) - (p.farmed / maxF) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" aria-hidden>
      <path
        d={d}
        fill="none"
        stroke="#e8cf8a"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function userStats(players: PublicPlayer[], now: number) {
  const settled = players.filter((p) => p.homeSectorId);
  const created = (p: PublicPlayer) => p.createdAt || 0;
  const updated = (p: PublicPlayer) => p.updatedAt || p.createdAt || 0;
  return {
    total: players.length,
    settled: settled.length,
    newDay: players.filter((p) => inLast(created(p), DAY, now)).length,
    newWeek: players.filter((p) => inLast(created(p), 7 * DAY, now)).length,
    newMonth: players.filter((p) => inLast(created(p), 30 * DAY, now)).length,
    activeDay: players.filter((p) => inLast(updated(p), DAY, now)).length,
    activeWeek: players.filter((p) => inLast(updated(p), 7 * DAY, now)).length,
    activeMonth: players.filter((p) => inLast(updated(p), 30 * DAY, now))
      .length,
  };
}

export default function ManagePage() {
  const { status } = useSession();
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sectorId, setSectorId] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Same snapshot the game already uses — full=1 for sector history
      const res = await fetch("/api/game?full=1", { cache: "no-store" });
      const data = (await res.json()) as GameSnapshot;
      if (!res.ok) {
        setError("Could not load game snapshot");
        setSnap(null);
        return;
      }
      setSnap(data);
    } catch {
      setError("Network error loading /api/game");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    void load();
  }, [status, load]);

  useEffect(() => {
    if (!snap?.sectors.length) return;
    if (sectorId && snap.sectors.some((s) => s.id === sectorId)) return;
    const top = mappedSectorAnalytics(
      snap.sectors,
      snap.players,
      snap.spots,
      snap.sectorHistory ?? {}
    )[0];
    setSectorId(top?.sectorId ?? snap.sectors[0]!.id);
  }, [snap, sectorId]);

  const now = snap?.serverNow ?? Date.now();
  const users = useMemo(
    () => userStats(snap?.players ?? [], now),
    [snap?.players, now]
  );

  const analytics = useMemo(
    () =>
      mappedSectorAnalytics(
        snap?.sectors ?? [],
        snap?.players ?? [],
        snap?.spots ?? [],
        snap?.sectorHistory ?? {}
      ),
    [snap]
  );

  const selected =
    analytics.find((a) => a.sectorId === sectorId) ?? analytics[0] ?? null;

  const topFarmers = useMemo(() => {
    return [...(snap?.players ?? [])]
      .sort((a, b) => (b.totalFarmed || 0) - (a.totalFarmed || 0))
      .slice(0, 12)
      .map((p) => ({
        id: p.id,
        label: p.name,
        value: p.totalFarmed || 0,
        color: p.color,
      }));
  }, [snap?.players]);

  const sectorBars = useMemo(
    () =>
      analytics.slice(0, 12).map((a) => ({
        id: a.sectorId,
        label: a.name,
        value: a.farmed,
        color: "#7ed4c8",
      })),
    [analytics]
  );

  const recentJoins = useMemo(() => {
    return [...(snap?.players ?? [])]
      .filter((p) => p.createdAt)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 15);
  }, [snap?.players]);

  if (status === "unauthenticated") {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center px-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
          Manage
        </p>
        <h1 className="mt-2 font-display text-3xl text-[var(--ink)]">
          Sign in required
        </h1>
        <p className="mt-2 mb-4 max-w-sm text-center text-sm text-[var(--ink-muted)]">
          Analytics are limited to admins. Sign in with Google to continue.
        </p>
        <GoogleSignInButton callbackUrl="/manage" label="Sign in with Google" />
        <Link
          href="/play"
          className="mt-6 font-mono text-[11px] text-[var(--sand)] underline"
        >
          Back to play
        </Link>
      </main>
    );
  }

  if (!loading && snap && !snap.isAdmin && !snap.authDisabled) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center px-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
          Manage
        </p>
        <h1 className="mt-2 font-display text-3xl text-[var(--ink)]">
          Admins only
        </h1>
        <p className="mt-2 max-w-sm text-center text-sm text-[var(--ink-muted)]">
          This dashboard uses the live game snapshot and is restricted to admin
          accounts.
        </p>
        <Link
          href="/play"
          className="mt-6 font-mono text-[11px] text-[var(--sand)] underline"
        >
          Back to play
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[var(--surface)] px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
              Manage · live snapshot
            </p>
            <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
              Analytics
            </h1>
            <p className="mt-1 text-[12px] text-[var(--ink-muted)]">
              Built from <code className="text-[var(--sand)]">/api/game?full=1</code>{" "}
              — no extra endpoints. Active ={" "}
              <span className="text-[var(--ink)]">updatedAt</span> in window;
              new = <span className="text-[var(--ink)]">createdAt</span>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-sm border border-[var(--line)] px-3 py-1.5 font-mono text-[11px] text-[var(--sand)] hover:border-[var(--sand)] disabled:opacity-40"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
            <Link
              href="/play"
              className="rounded-sm border border-[var(--line)] px-3 py-1.5 font-mono text-[11px] text-[var(--ink-muted)] hover:text-[var(--sand)]"
            >
              Play
            </Link>
            <Link
              href="/edit"
              className="rounded-sm border border-[var(--line)] px-3 py-1.5 font-mono text-[11px] text-[var(--ink-muted)] hover:text-[var(--sand)]"
            >
              Map edit
            </Link>
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-sm border border-[#6a3f3a] px-3 py-2 text-[12px] text-[#e88a7a]">
            {error}
          </p>
        )}

        {loading && !snap && (
          <p className="mt-8 text-[13px] text-[var(--ink-faint)]">
            Loading snapshot…
          </p>
        )}

        {snap && (
          <div className="mt-6 space-y-8">
            <section>
              <h2 className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                World
              </h2>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatCard label="Players" value={String(users.total)} />
                <StatCard label="Settled" value={String(users.settled)} />
                <StatCard
                  label="Sectors"
                  value={String(snap.sectors.length)}
                />
                <StatCard
                  label="Storage"
                  value={snap.storageBackend}
                  hint="From game snapshot"
                />
              </div>
            </section>

            <section>
              <h2 className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                Users — new vs active
              </h2>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <StatCard
                  label="New · 24h"
                  value={String(users.newDay)}
                  hint="createdAt within 24h"
                />
                <StatCard
                  label="New · 7d"
                  value={String(users.newWeek)}
                  hint="createdAt within 7 days"
                />
                <StatCard
                  label="New · 30d"
                  value={String(users.newMonth)}
                  hint="createdAt within 30 days"
                />
                <StatCard
                  label="Active · 24h"
                  value={String(users.activeDay)}
                  hint="updatedAt within 24h"
                />
                <StatCard
                  label="Active · 7d"
                  value={String(users.activeWeek)}
                  hint="updatedAt within 7 days"
                />
                <StatCard
                  label="Active · 30d"
                  value={String(users.activeMonth)}
                  hint="updatedAt within 30 days"
                />
              </div>
            </section>

            <section className="grid gap-6 sm:grid-cols-2">
              <div>
                <h2 className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                  Top farmers
                </h2>
                <MiniBars items={topFarmers} empty="No players yet" />
              </div>
              <div>
                <h2 className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                  Top sectors (farmed)
                </h2>
                <MiniBars items={sectorBars} empty="No sectors yet" />
              </div>
            </section>

            <section>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h2 className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                  Sector growth
                </h2>
                <select
                  value={selected?.sectorId ?? ""}
                  onChange={(e) => setSectorId(e.target.value)}
                  className="rounded-sm border border-[var(--line)] bg-[var(--wash)] px-2 py-1 font-mono text-[11px] text-[var(--ink)]"
                >
                  {analytics.map((a) => (
                    <option key={a.sectorId} value={a.sectorId}>
                      {a.name} · {GOLD_COIN}
                      {formatGoldCompact(a.farmed)} · {a.settlers}p
                    </option>
                  ))}
                </select>
              </div>
              {selected && (
                <div className="mt-2 rounded-sm border border-[var(--line)] bg-[var(--wash)] p-3">
                  <div className="flex flex-wrap gap-3 font-mono text-[11px] text-[var(--ink-muted)]">
                    <span>
                      Farmed{" "}
                      <strong className="text-[#e8cf8a]">
                        {GOLD_COIN}
                        {formatGoldCompact(selected.farmed)}
                      </strong>
                    </span>
                    <span>
                      Settlers <strong className="text-[var(--ink)]">{selected.settlers}</strong>
                    </span>
                    <span>
                      Villagers <strong className="text-[var(--ink)]">{selected.villagers}</strong>
                    </span>
                    <span>
                      Buildings <strong className="text-[var(--ink)]">{selected.buildings}</strong>
                    </span>
                    <span>
                      Samples{" "}
                      <strong className="text-[var(--ink)]">
                        {selected.history.length}
                      </strong>
                    </span>
                  </div>
                  <div className="mt-3">
                    <GrowthSpark history={selected.history} />
                  </div>
                  <div className="mt-3 max-h-48 overflow-auto">
                    <table className="w-full text-left font-mono text-[10px]">
                      <thead className="text-[var(--ink-faint)]">
                        <tr className="border-b border-[var(--line)]">
                          <th className="py-1 pr-2 font-normal">When</th>
                          <th className="py-1 pr-2 font-normal">Farmed</th>
                          <th className="py-1 pr-2 font-normal">Settlers</th>
                          <th className="py-1 font-normal">Villagers</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...selected.history].reverse().slice(0, 24).map((p) => (
                          <tr
                            key={p.ts}
                            className="border-b border-[var(--line)]/50 text-[var(--ink-muted)]"
                          >
                            <td className="py-1 pr-2 whitespace-nowrap">
                              {formatWhen(p.ts)}
                            </td>
                            <td className="py-1 pr-2 text-[#e8cf8a]">
                              {formatGoldCompact(p.farmed)}
                            </td>
                            <td className="py-1 pr-2">{p.settlers}</td>
                            <td className="py-1">{p.villagers}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                Recent joins
              </h2>
              <ul className="space-y-1">
                {recentJoins.length === 0 && (
                  <li className="text-[12px] text-[var(--ink-faint)]">
                    No players with createdAt yet
                  </li>
                )}
                {recentJoins.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-sm border border-[var(--line)] px-2.5 py-1.5 text-[12px]"
                  >
                    <span className="min-w-0 truncate">
                      <strong style={{ color: p.color }}>{p.name}</strong>
                      <span className="ml-2 font-mono text-[10px] text-[var(--ink-faint)]">
                        {p.homeSectorId
                          ? snap.sectors.find((s) => s.id === p.homeSectorId)
                              ?.name ?? "settled"
                          : "unsettled"}{" "}
                        · {p.buildings?.length || 0}b · {GOLD_COIN}
                        {formatGoldCompact(p.totalFarmed || 0)}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-[var(--ink-faint)]">
                      {p.createdAt ? formatWhen(p.createdAt) : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <p className="pb-8 font-mono text-[9px] text-[var(--ink-faint)]">
              Snapshot time {formatWhen(snap.serverNow)} · refresh reuses the
              same game API the client already polls.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
