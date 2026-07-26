"use client";

import {
  healthDotClass,
  healthLabel,
  type ClientHealth,
  type ServerHealth,
} from "@/lib/health";

type Props = {
  client: ClientHealth;
  server: ServerHealth | null;
  serverLoading: boolean;
  onRefresh: () => void;
  onClose: () => void;
};

function Row({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok?: boolean | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--line)]/70 py-1.5 text-[11px]">
      <span className="text-[var(--ink-muted)]">{label}</span>
      <span
        className={`font-mono tabular-nums ${
          ok === false
            ? "text-[#e88a7a]"
            : ok === true
              ? "text-[#8fe098]"
              : "text-[var(--ink)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function LevelBadge({ level }: { level: ClientHealth["level"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
      <span
        className={`inline-block h-2 w-2 rounded-full ${healthDotClass(level)}`}
      />
      {healthLabel(level)}
    </span>
  );
}

export function HealthPanel({
  client,
  server,
  serverLoading,
  onRefresh,
  onClose,
}: Props) {
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
        className="hud-panel max-h-[min(88dvh,36rem)] w-full max-w-md overflow-hidden p-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Game health"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl text-[var(--ink)]">
              Game health
            </h2>
            <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
              Local client · server probe
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-sm border border-[var(--line)] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--sand)] hover:border-[var(--sand)]"
            >
              {serverLoading ? "…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="font-mono text-[14px] text-[var(--ink-faint)] hover:text-[var(--sand)]"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="mt-3 space-y-4 overflow-y-auto pr-1">
          <section>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                Local
              </h3>
              <LevelBadge level={client.level} />
            </div>
            <Row
              label="Network"
              value={client.online ? "online" : "offline"}
              ok={client.online}
            />
            <Row
              label="Last sync"
              value={
                client.poll.lastOkAt
                  ? `${Math.round((Date.now() - client.poll.lastOkAt) / 1000)}s ago`
                  : "never"
              }
              ok={
                client.poll.lastOkAt
                  ? Date.now() - client.poll.lastOkAt < 15_000
                  : false
              }
            />
            <Row
              label="Poll latency"
              value={
                client.poll.lastLatencyMs != null
                  ? `${client.poll.lastLatencyMs}ms`
                  : "—"
              }
              ok={
                client.poll.lastLatencyMs == null
                  ? null
                  : client.poll.lastLatencyMs < 1500
              }
            />
            <p className="mt-1 font-mono text-[9px] text-[var(--ink-faint)]">
              Poll = full /api/game sync. Probe = lightweight /api/health.
              Overlapping polls are skipped while one is in flight.
            </p>
            <Row
              label="Fail streak"
              value={String(client.poll.failStreak)}
              ok={client.poll.failStreak === 0}
            />
            <Row
              label="Clock skew"
              value={
                client.clockSkewMs == null
                  ? "—"
                  : `${client.clockSkewMs > 0 ? "+" : ""}${client.clockSkewMs}ms`
              }
              ok={
                client.clockSkewMs == null
                  ? null
                  : Math.abs(client.clockSkewMs) < 10_000
              }
            />
            <Row
              label="localStorage"
              value={client.localStorage ? "ok" : "blocked"}
              ok={client.localStorage}
            />
            <Row
              label="Mapbox token"
              value={client.mapboxToken ? "present" : "missing"}
              ok={client.mapboxToken}
            />
            {client.poll.lastError && (
              <p className="mt-1.5 rounded-sm border border-[#6a3f3a] bg-black/25 px-2 py-1.5 font-mono text-[10px] text-[#e88a7a]">
                {client.poll.lastError}
              </p>
            )}
            {client.issues.length > 0 && (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[10px] text-[#e8cf8a]">
                {client.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                Server
              </h3>
              <LevelBadge level={server?.level ?? "unknown"} />
            </div>
            {!server && (
              <p className="py-2 text-[11px] text-[var(--ink-faint)]">
                {serverLoading ? "Probing…" : "No server report yet"}
              </p>
            )}
            {server && (
              <>
                <Row
                  label="Probe latency"
                  value={`${server.latencyMs}ms`}
                  ok={server.latencyMs < 2500}
                />
                <Row
                  label="Storage"
                  value={`${server.storage.backend}${
                    server.storage.reachable ? "" : " (down)"
                  }`}
                  ok={server.storage.reachable && server.storage.backend !== "memory"}
                />
                <Row
                  label="Storage ping"
                  value={
                    server.storage.latencyMs != null
                      ? `${server.storage.latencyMs}ms`
                      : "—"
                  }
                  ok={
                    server.storage.latencyMs == null
                      ? null
                      : server.storage.latencyMs < 2500
                  }
                />
                <Row
                  label="Sectors"
                  value={String(server.game.sectors)}
                  ok={server.game.sectors > 0}
                />
                <Row label="Players" value={String(server.game.players)} />
                <Row
                  label="Auth / Google"
                  value={
                    server.env.authDisabled
                      ? "guest mode"
                      : server.env.googleOAuth && server.env.authSecret
                        ? "configured"
                        : "incomplete"
                  }
                  ok={
                    server.env.authDisabled ||
                    (server.env.googleOAuth && server.env.authSecret)
                  }
                />
                <Row
                  label="Mapbox (server)"
                  value={server.env.mapbox ? "present" : "missing"}
                  ok={server.env.mapbox}
                />
                {server.issues.length > 0 && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[10px] text-[#e8cf8a]">
                    {server.issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
