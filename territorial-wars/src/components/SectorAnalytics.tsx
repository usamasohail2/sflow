"use client";

import { useMemo, useState } from "react";
import {
  formatGoldCompact,
  GOLD_COIN,
  type SectorAnalytics as SectorAnalyticsRow,
  type SectorStatsPoint,
} from "@/lib/gameTypes";
import { buildingLabel } from "@/lib/sectorAnalytics";

type Props = {
  rows: SectorAnalyticsRow[];
  initialSectorId?: string | null;
  onClose: () => void;
  onFlyTo?: (sectorId: string) => void;
};

type Tab = "overview" | "players" | "resources" | "growth";

function formatWhen(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function BarChart({
  items,
  valueKey,
  maxBars = 12,
}: {
  items: { id: string; label: string; color: string; value: number }[];
  valueKey: string;
  maxBars?: number;
}) {
  const slice = items.slice(0, maxBars);
  const max = Math.max(1, ...slice.map((i) => i.value));
  if (slice.length === 0) {
    return (
      <p className="py-4 text-center text-[11px] text-[var(--ink-faint)]">
        No data yet
      </p>
    );
  }
  return (
    <div className="space-y-1.5" role="img" aria-label={`${valueKey} chart`}>
      {slice.map((item) => (
        <div key={item.id} className="flex items-center gap-2">
          <span
            className="w-[5.5rem] shrink-0 truncate text-[10px] text-[var(--ink-muted)]"
            title={item.label}
          >
            {item.label}
          </span>
          <div className="relative h-3.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-black/35">
            <div
              className="h-full rounded-sm transition-[width] duration-500"
              style={{
                width: `${Math.max(4, (item.value / max) * 100)}%`,
                background: `linear-gradient(90deg, ${item.color}, color-mix(in srgb, ${item.color} 55%, #e8cf8a))`,
              }}
            />
          </div>
          <span className="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-[#e8cf8a]">
            {formatGoldCompact(item.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function GrowthChart({ history }: { history: SectorStatsPoint[] }) {
  const w = 320;
  const h = 140;
  const pad = { t: 12, r: 12, b: 22, l: 36 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const series = history.length >= 2 ? history : history;
  const maxFarmed = Math.max(1, ...series.map((p) => p.farmed));
  const maxSettlers = Math.max(1, ...series.map((p) => p.settlers));
  const t0 = series[0]?.ts ?? Date.now();
  const t1 = series[series.length - 1]?.ts ?? t0 + 1;
  const span = Math.max(1, t1 - t0);

  const farmedPath = series
    .map((p, i) => {
      const x = pad.l + ((p.ts - t0) / span) * innerW;
      const y = pad.t + innerH - (p.farmed / maxFarmed) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const settlerPath = series
    .map((p, i) => {
      const x = pad.l + ((p.ts - t0) / span) * innerW;
      const y = pad.t + innerH - (p.settlers / maxSettlers) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  if (series.length === 0) {
    return (
      <p className="py-6 text-center text-[11px] text-[var(--ink-faint)]">
        Growth samples will appear as the sector farms
      </p>
    );
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-auto w-full"
        role="img"
        aria-label="Sector growth timeline"
      >
        <rect
          x={pad.l}
          y={pad.t}
          width={innerW}
          height={innerH}
          fill="rgba(0,0,0,0.25)"
          rx="2"
        />
        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1={pad.l}
            x2={pad.l + innerW}
            y1={pad.t + innerH * (1 - g)}
            y2={pad.t + innerH * (1 - g)}
            stroke="rgba(232,235,228,0.08)"
            strokeWidth="1"
          />
        ))}
        <path
          d={farmedPath}
          fill="none"
          stroke="#e8cf8a"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={settlerPath}
          fill="none"
          stroke="#5eb8ff"
          strokeWidth="1.6"
          strokeDasharray="3 2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {series.map((p) => {
          const x = pad.l + ((p.ts - t0) / span) * innerW;
          const yF = pad.t + innerH - (p.farmed / maxFarmed) * innerH;
          return (
            <circle
              key={p.ts}
              cx={x}
              cy={yF}
              r="2.2"
              fill="#e8cf8a"
            />
          );
        })}
        <text
          x={pad.l}
          y={h - 4}
          fill="#6a7264"
          fontSize="8"
          fontFamily="ui-monospace, monospace"
        >
          {formatWhen(t0)}
        </text>
        <text
          x={pad.l + innerW}
          y={h - 4}
          fill="#6a7264"
          fontSize="8"
          fontFamily="ui-monospace, monospace"
          textAnchor="end"
        >
          {formatWhen(t1)}
        </text>
        <text
          x={4}
          y={pad.t + 4}
          fill="#6a7264"
          fontSize="8"
          fontFamily="ui-monospace, monospace"
        >
          {formatGoldCompact(maxFarmed)}
        </text>
        <text
          x={4}
          y={pad.t + innerH}
          fill="#6a7264"
          fontSize="8"
          fontFamily="ui-monospace, monospace"
        >
          0
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-[9px] text-[var(--ink-faint)]">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 bg-[#e8cf8a]" /> Farmed
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-0.5 w-3 bg-[#5eb8ff]"
            style={{ borderTop: "1px dashed #5eb8ff" }}
          />{" "}
          Settlers
        </span>
        <span>{series.length} samples</span>
      </div>
    </div>
  );
}

function StatChip({
  label,
  value,
  tip,
}: {
  label: string;
  value: string;
  tip?: string;
}) {
  return (
    <div
      className="rounded-sm border border-[var(--line)] bg-black/20 px-2 py-1.5"
      title={tip}
    >
      <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[12px] font-semibold tabular-nums text-[var(--ink)]">
        {value}
      </div>
    </div>
  );
}

export function SectorAnalyticsModal({
  rows,
  initialSectorId = null,
  onClose,
  onFlyTo,
}: Props) {
  const [sectorId, setSectorId] = useState(
    () =>
      initialSectorId && rows.some((r) => r.sectorId === initialSectorId)
        ? initialSectorId
        : rows[0]?.sectorId ?? ""
  );
  const [tab, setTab] = useState<Tab>("overview");

  const row = useMemo(
    () => rows.find((r) => r.sectorId === sectorId) ?? rows[0] ?? null,
    [rows, sectorId]
  );

  const playerFarmed = useMemo(
    () =>
      (row?.players ?? []).map((p) => ({
        id: p.id,
        label: p.name,
        color: p.color || "#c4b089",
        value: p.farmed,
      })),
    [row]
  );
  const playerGold = useMemo(
    () =>
      (row?.players ?? []).map((p) => ({
        id: p.id,
        label: p.name,
        color: p.color || "#c4b089",
        value: p.gold,
      })),
    [row]
  );
  const playerVillagers = useMemo(
    () =>
      (row?.players ?? []).map((p) => ({
        id: p.id,
        label: p.name,
        color: p.color || "#8fe098",
        value: p.villagers,
      })),
    [row]
  );
  const buildingBars = useMemo(() => {
    if (!row) return [];
    return Object.entries(row.buildingMix)
      .map(([type, count]) => ({
        id: type,
        label: buildingLabel(type as Parameters<typeof buildingLabel>[0]),
        color: "#7ed4c8",
        value: count || 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [row]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "players", label: "Players" },
    { id: "resources", label: "Resources" },
    { id: "growth", label: "Growth" },
  ];

  return (
    <div
      className="absolute inset-0 z-40 flex items-end justify-center bg-black/55 p-3 sm:items-center"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <div
        className="hud-panel flex max-h-[min(88dvh,40rem)] w-full max-w-lg flex-col overflow-hidden p-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Sector analytics"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-xl text-[var(--ink)]">
              Sector analytics
            </h2>
            <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
              Players · resources · growth
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[14px] text-[var(--ink-faint)] hover:text-[var(--sand)]"
          >
            ✕
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="mt-6 text-center text-[12px] text-[var(--ink-faint)]">
            No sectors on the map yet
          </p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="sector-analytics-select">
                Sector
              </label>
              <select
                id="sector-analytics-select"
                value={row?.sectorId ?? ""}
                onChange={(e) => {
                  setSectorId(e.target.value);
                  setTab("overview");
                }}
                className="min-w-0 flex-1 rounded-sm border border-[var(--line)] bg-[var(--wash)] px-2 py-1.5 font-mono text-[11px] text-[var(--ink)]"
              >
                {rows.map((r) => (
                  <option key={r.sectorId} value={r.sectorId}>
                    {r.name} · {GOLD_COIN}
                    {formatGoldCompact(r.farmed)} · {r.settlers}p
                  </option>
                ))}
              </select>
              {row && onFlyTo && (
                <button
                  type="button"
                  onClick={() => onFlyTo(row.sectorId)}
                  className="shrink-0 rounded-sm border border-[var(--line)] px-2 py-1.5 font-mono text-[10px] text-[var(--sand)] hover:border-[var(--sand)]"
                >
                  Fly to
                </button>
              )}
            </div>

            <div className="mt-2 flex gap-1 border-b border-[var(--line)] pb-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
                    tab === t.id
                      ? "bg-[var(--wash)] text-[var(--sand)]"
                      : "text-[var(--ink-faint)] hover:text-[var(--ink-muted)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
              {!row ? null : tab === "overview" ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    <StatChip
                      label="Farmed"
                      value={`${GOLD_COIN}${formatGoldCompact(row.farmed)}`}
                    />
                    <StatChip label="Settlers" value={String(row.settlers)} />
                    <StatChip label="Villagers" value={String(row.villagers)} />
                    <StatChip
                      label="Gold pool"
                      value={`${GOLD_COIN}${formatGoldCompact(row.gold)}`}
                    />
                    <StatChip label="Buildings" value={String(row.buildings)} />
                    <StatChip label="Rockets" value={String(row.rockets)} />
                    <StatChip
                      label="Houses up"
                      value={`${row.housesUp}/${row.settlers}`}
                    />
                    <StatChip
                      label="Base yield"
                      value={`${GOLD_COIN}${row.baseYield}/trip`}
                      tip="Sum of easy gather node yields in this sector"
                    />
                  </div>
                  <section>
                    <h3 className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                      Top farmers
                    </h3>
                    <BarChart items={playerFarmed} valueKey="farmed" maxBars={6} />
                  </section>
                  <section>
                    <h3 className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                      Growth (preview)
                    </h3>
                    <GrowthChart history={row.history} />
                  </section>
                </div>
              ) : tab === "players" ? (
                <div className="space-y-4">
                  <section>
                    <h3 className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                      Resources farmed
                    </h3>
                    <BarChart items={playerFarmed} valueKey="farmed" />
                  </section>
                  <section>
                    <h3 className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                      Gold on hand
                    </h3>
                    <BarChart items={playerGold} valueKey="gold" />
                  </section>
                  <section>
                    <h3 className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                      Villagers
                    </h3>
                    <BarChart items={playerVillagers} valueKey="villagers" />
                  </section>
                  <section>
                    <h3 className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                      Roster
                    </h3>
                    <ul className="space-y-1">
                      {row.players.length === 0 && (
                        <li className="text-[11px] text-[var(--ink-faint)]">
                          No settlers in this sector
                        </li>
                      )}
                      {row.players.map((p, i) => (
                        <li
                          key={p.id}
                          className="flex items-center justify-between gap-2 rounded-sm border border-[var(--line)] px-2 py-1.5 text-[11px]"
                        >
                          <span className="min-w-0 truncate">
                            <span className="font-mono text-[var(--ink-faint)]">
                              {i + 1}.
                            </span>{" "}
                            <strong style={{ color: p.color }}>{p.name}</strong>
                            <span className="ml-1.5 font-mono text-[9px] text-[var(--ink-faint)]">
                              {p.hasHouse
                                ? `HP ${p.houseHp}`
                                : "house down"}{" "}
                              · {p.villagers}v · {p.buildings}b · {p.rockets}r
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-[#e8cf8a]">
                            {GOLD_COIN}
                            {formatGoldCompact(p.farmed)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              ) : tab === "resources" ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    <StatChip
                      label="Easy nodes"
                      value={String(row.spotsEasy)}
                    />
                    <StatChip
                      label="Claimable finds"
                      value={String(row.spotsClaimable)}
                    />
                    <StatChip
                      label="Yield / trip"
                      value={`${GOLD_COIN}${row.baseYield}`}
                    />
                  </div>
                  <section>
                    <h3 className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                      Building mix
                    </h3>
                    {buildingBars.length === 0 ? (
                      <p className="text-[11px] text-[var(--ink-faint)]">
                        No buildings placed yet
                      </p>
                    ) : (
                      <BarChart items={buildingBars} valueKey="buildings" />
                    )}
                  </section>
                  <section>
                    <h3 className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                      Economy split
                    </h3>
                    <BarChart
                      items={[
                        {
                          id: "farmed",
                          label: "Lifetime farmed",
                          color: "#e8cf8a",
                          value: row.farmed,
                        },
                        {
                          id: "gold",
                          label: "Gold held",
                          color: "#c4b089",
                          value: row.gold,
                        },
                        {
                          id: "rockets",
                          label: "Rockets",
                          color: "#e88a7a",
                          value: row.rockets,
                        },
                        {
                          id: "villagers",
                          label: "Villagers",
                          color: "#8fe098",
                          value: row.villagers,
                        },
                      ]}
                      valueKey="economy"
                    />
                  </section>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[11px] text-[var(--ink-muted)]">
                    Hourly samples of farmed total and settler count. New points
                    appear as the world stays active.
                  </p>
                  <GrowthChart history={row.history} />
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[18rem] text-left font-mono text-[10px]">
                      <thead className="text-[var(--ink-faint)]">
                        <tr className="border-b border-[var(--line)]">
                          <th className="py-1 pr-2 font-normal">When</th>
                          <th className="py-1 pr-2 font-normal">Farmed</th>
                          <th className="py-1 pr-2 font-normal">Settlers</th>
                          <th className="py-1 pr-2 font-normal">Villagers</th>
                          <th className="py-1 font-normal">Buildings</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...row.history].reverse().map((p) => (
                          <tr
                            key={p.ts}
                            className="border-b border-[var(--line)]/60 text-[var(--ink-muted)]"
                          >
                            <td className="py-1 pr-2 whitespace-nowrap">
                              {formatWhen(p.ts)}
                            </td>
                            <td className="py-1 pr-2 text-[#e8cf8a]">
                              {formatGoldCompact(p.farmed)}
                            </td>
                            <td className="py-1 pr-2">{p.settlers}</td>
                            <td className="py-1 pr-2">{p.villagers}</td>
                            <td className="py-1">{p.buildings}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
