"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { ManageChat } from "@/components/ManageChat";
import {
  formatGoldCompact,
  GOLD_COIN,
  isAzadHomeId,
  type GameSnapshot,
  type PublicPlayer,
  type SectorStatsPoint,
} from "@/lib/gameTypes";
import { mappedSectorAnalytics } from "@/lib/sectorAnalytics";
import { timeAgo } from "@/lib/timeAgo";

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

function EasyCard({
  title,
  value,
  note,
}: {
  title: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-sm border border-[var(--line)] bg-[var(--wash)] px-3 py-2.5">
      <div className="text-[12px] text-[var(--ink-muted)]">{title}</div>
      <div className="mt-0.5 font-display text-2xl text-[var(--ink)]">
        {value}
      </div>
      {note && (
        <div className="mt-0.5 text-[11px] text-[var(--ink-faint)]">{note}</div>
      )}
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
    return <p className="text-[13px] text-[var(--ink-faint)]">{empty}</p>;
  }
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={item.id} className="flex items-center gap-2">
          <span className="w-5 shrink-0 font-mono text-[11px] text-[var(--ink-faint)]">
            {i + 1}.
          </span>
          <span className="w-28 shrink-0 truncate text-[13px] text-[var(--ink-muted)]">
            {item.label}
          </span>
          <div className="h-3.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-black/35">
            <div
              className="h-full rounded-sm"
              style={{
                width: `${Math.max(4, (item.value / max) * 100)}%`,
                background: item.color || "#e8cf8a",
              }}
            />
          </div>
          <span className="w-14 shrink-0 text-right font-mono text-[11px] text-[#e8cf8a]">
            {GOLD_COIN}
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
      <p className="py-4 text-center text-[12px] text-[var(--ink-faint)]">
        No growth numbers yet
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
    activeDay: players.filter((p) => inLast(updated(p), DAY, now)).length,
    activeWeek: players.filter((p) => inLast(updated(p), 7 * DAY, now)).length,
  };
}

export default function ManagePage() {
  const { data: session, status } = useSession();
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sectorId, setSectorId] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/game?full=1", { cache: "no-store" });
      const data = (await res.json()) as GameSnapshot;
      if (!res.ok) {
        setError("Could not load the game. Try again.");
        setSnap(null);
        return;
      }
      setSnap(data);
    } catch {
      setError("No internet — try again.");
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
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        label: p.name,
        value: p.totalFarmed || 0,
        color: p.color,
      }));
  }, [snap?.players]);

  const sectorBars = useMemo(
    () =>
      analytics.slice(0, 10).map((a) => ({
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
      .slice(0, 20);
  }, [snap?.players]);

  const chatVisitorId = snap?.me?.id || "";
  const chatName =
    snap?.me?.name ||
    session?.user?.name ||
    session?.user?.email?.split("@")[0] ||
    "Admin";

  if (status === "unauthenticated") {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center px-5">
        <h1 className="font-display text-3xl text-[var(--ink)]">
          Please sign in
        </h1>
        <p className="mt-2 mb-4 max-w-sm text-center text-sm text-[var(--ink-muted)]">
          Only helpers can open this page. Sign in with Google.
        </p>
        <GoogleSignInButton callbackUrl="/manage" label="Sign in with Google" />
        <Link
          href="/play"
          className="mt-6 text-[13px] text-[var(--sand)] underline"
        >
          Back to the game
        </Link>
      </main>
    );
  }

  if (!loading && snap && !snap.isAdmin && !snap.authDisabled) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center px-5">
        <h1 className="font-display text-3xl text-[var(--ink)]">
          Helpers only
        </h1>
        <p className="mt-2 max-w-sm text-center text-sm text-[var(--ink-muted)]">
          This page is for people who help run the game.
        </p>
        <Link
          href="/play"
          className="mt-6 text-[13px] text-[var(--sand)] underline"
        >
          Back to the game
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[var(--surface)] px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl text-[var(--ink)]">
              Game look-see
            </h1>
            <p className="mt-1 max-w-md text-[14px] text-[var(--ink-muted)]">
              See who just joined, read the chat, and check who is winning.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-[13px] font-semibold text-[var(--sand)] hover:border-[var(--sand)] disabled:opacity-40"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
            <Link
              href="/play"
              className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-[13px] text-[var(--ink-muted)] hover:text-[var(--sand)]"
            >
              Play
            </Link>
            <Link
              href="/edit"
              className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-[13px] text-[var(--ink-muted)] hover:text-[var(--sand)]"
            >
              Edit map
            </Link>
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-sm border border-[#6a3f3a] px-3 py-2 text-[13px] text-[#e88a7a]">
            {error}
          </p>
        )}

        {loading && !snap && (
          <p className="mt-8 text-[14px] text-[var(--ink-faint)]">
            Loading the game…
          </p>
        )}

        {snap && (
          <div className="mt-6 space-y-8">
            {/* 1) Recent joins — top */}
            <section>
              <h2 className="font-display text-xl text-[var(--ink)]">
                New players
              </h2>
              <p className="mt-0.5 text-[13px] text-[var(--ink-muted)]">
                People who signed up most recently
              </p>
              <ul className="mt-3 space-y-1.5">
                {recentJoins.length === 0 && (
                  <li className="text-[13px] text-[var(--ink-faint)]">
                    Nobody new yet
                  </li>
                )}
                {recentJoins.map((p) => {
                  const home =
                    p.homeSectorId && !isAzadHomeId(p.homeSectorId)
                      ? snap.sectors.find((s) => s.id === p.homeSectorId)?.name
                      : p.homeSectorId
                        ? "Azad Umeed"
                        : null;
                  return (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-2 rounded-sm border border-[var(--line)] bg-[var(--wash)] px-3 py-2 text-[13px]"
                    >
                      <span className="min-w-0 truncate">
                        <strong style={{ color: p.color }}>{p.name}</strong>
                        <span className="ml-2 text-[var(--ink-muted)]">
                          {home
                            ? `lives in ${home}`
                            : "has not picked a home yet"}
                          {" · "}
                          {GOLD_COIN}
                          {formatGoldCompact(p.totalFarmed || 0)} gold
                        </span>
                      </span>
                      <span
                        className="shrink-0 text-[12px] text-[var(--ink-faint)]"
                        title={
                          p.createdAt ? formatWhen(p.createdAt) : undefined
                        }
                      >
                        {p.createdAt ? timeAgo(p.createdAt, now) : "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* 2) Full chat */}
            <section>
              {chatVisitorId ? (
                <ManageChat
                  visitorId={chatVisitorId}
                  displayName={chatName}
                />
              ) : (
                <div className="rounded-sm border border-[var(--line)] bg-[var(--wash)] px-3 py-6 text-center text-[13px] text-[var(--ink-muted)]">
                  Sign in fully to use chat here.
                </div>
              )}
            </section>

            {/* 3) Simple counts */}
            <section>
              <h2 className="font-display text-xl text-[var(--ink)]">
                Quick numbers
              </h2>
              <p className="mt-0.5 text-[13px] text-[var(--ink-muted)]">
                Easy totals for the whole map
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <EasyCard title="People in the game" value={String(users.total)} />
                <EasyCard
                  title="Have a home"
                  value={String(users.settled)}
                  note="They planted a house"
                />
                <EasyCard
                  title="Map areas"
                  value={String(snap.sectors.length)}
                />
                <EasyCard
                  title="Joined today"
                  value={String(users.newDay)}
                />
                <EasyCard
                  title="Played today"
                  value={String(users.activeDay)}
                />
                <EasyCard
                  title="Joined this week"
                  value={String(users.newWeek)}
                />
              </div>
            </section>

            {/* 4) Leaders */}
            <section className="grid gap-6 sm:grid-cols-2">
              <div>
                <h2 className="font-display text-xl text-[var(--ink)]">
                  Gold leaders
                </h2>
                <p className="mb-3 mt-0.5 text-[13px] text-[var(--ink-muted)]">
                  Who farmed the most gold
                </p>
                <MiniBars items={topFarmers} empty="No players yet" />
              </div>
              <div>
                <h2 className="font-display text-xl text-[var(--ink)]">
                  Strongest areas
                </h2>
                <p className="mb-3 mt-0.5 text-[13px] text-[var(--ink-muted)]">
                  Which sector has the most gold
                </p>
                <MiniBars items={sectorBars} empty="No areas yet" />
              </div>
            </section>

            {/* 5) One sector peek */}
            <section>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="font-display text-xl text-[var(--ink)]">
                    One area up close
                  </h2>
                  <p className="mt-0.5 text-[13px] text-[var(--ink-muted)]">
                    Pick an area to see if it is growing
                  </p>
                </div>
                <select
                  value={selected?.sectorId ?? ""}
                  onChange={(e) => setSectorId(e.target.value)}
                  className="rounded-sm border border-[var(--line)] bg-[var(--wash)] px-2 py-1.5 text-[13px] text-[var(--ink)]"
                >
                  {analytics.map((a) => (
                    <option key={a.sectorId} value={a.sectorId}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              {selected && (
                <div className="mt-3 rounded-sm border border-[var(--line)] bg-[var(--wash)] p-3">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[var(--ink-muted)]">
                    <span>
                      Gold:{" "}
                      <strong className="text-[#e8cf8a]">
                        {GOLD_COIN}
                        {formatGoldCompact(selected.farmed)}
                      </strong>
                    </span>
                    <span>
                      People:{" "}
                      <strong className="text-[var(--ink)]">
                        {selected.settlers}
                      </strong>
                    </span>
                    <span>
                      Villagers:{" "}
                      <strong className="text-[var(--ink)]">
                        {selected.villagers}
                      </strong>
                    </span>
                    <span>
                      Buildings:{" "}
                      <strong className="text-[var(--ink)]">
                        {selected.buildings}
                      </strong>
                    </span>
                  </div>
                  <div className="mt-3">
                    <GrowthSpark history={selected.history} />
                  </div>
                </div>
              )}
            </section>

            <p className="pb-8 text-[12px] text-[var(--ink-faint)]">
              Updated {formatWhen(snap.serverNow)}. Press Refresh for new numbers.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
