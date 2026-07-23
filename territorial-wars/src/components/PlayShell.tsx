"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

const SECTORS = [
  "F-6",
  "F-7",
  "F-8",
  "F-10",
  "G-6",
  "G-9",
  "Blue Area",
  "E-11",
  "I-8",
  "Bahria",
] as const;

type Claim = {
  sector: (typeof SECTORS)[number];
  owner: "you" | "rival" | "neutral";
};

function initialClaims(): Claim[] {
  return SECTORS.map((sector, i) => ({
    sector,
    owner: i % 5 === 0 ? "rival" : i % 3 === 0 ? "you" : "neutral",
  }));
}

export function PlayShell() {
  const [claims, setClaims] = useState<Claim[]>(initialClaims);
  const [selected, setSelected] = useState<(typeof SECTORS)[number] | null>(
    null
  );

  const selectedClaim = useMemo(
    () => claims.find((c) => c.sector === selected) ?? null,
    [claims, selected]
  );

  const yourCount = claims.filter((c) => c.owner === "you").length;

  const claimSelected = () => {
    if (!selected) return;
    setClaims((prev) =>
      prev.map((c) =>
        c.sector === selected ? { ...c, owner: "you" as const } : c
      )
    );
  };

  return (
    <main className="war-grid relative min-h-[100dvh]">
      <header className="relative z-10 flex items-center justify-between border-b border-[var(--line)] px-4 py-3 sm:px-6">
        <div>
          <Link
            href="/"
            className="font-display text-sm tracking-tight text-[var(--ink)] sm:text-base"
          >
            Islamabad Territorial Wars
          </Link>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
            Live board · prototype
          </p>
        </div>
        <p className="font-mono text-[11px] text-[var(--sand)]">
          Held <span className="text-[var(--ink)]">{yourCount}</span>/{SECTORS.length}
        </p>
      </header>

      <div className="relative z-10 mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1.4fr_0.9fr]">
        <section>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">
            Sectors
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {claims.map((claim) => {
              const active = selected === claim.sector;
              const tone =
                claim.owner === "you"
                  ? "border-[var(--field-bright)] bg-[var(--field)]/25 text-[var(--field-bright)]"
                  : claim.owner === "rival"
                    ? "border-[var(--signal)]/60 bg-[var(--signal)]/15 text-[var(--signal-bright)]"
                    : "border-[var(--line-strong)] bg-[var(--wash)]/40 text-[var(--ink-muted)]";
              return (
                <li key={claim.sector}>
                  <button
                    type="button"
                    onClick={() => setSelected(claim.sector)}
                    className={`w-full rounded-sm border px-3 py-4 text-left transition ${tone} ${
                      active ? "ring-2 ring-[var(--sand)]" : "hover:brightness-110"
                    }`}
                  >
                    <span className="block font-display text-lg tracking-tight">
                      {claim.sector}
                    </span>
                    <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.18em]">
                      {claim.owner}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="rounded-sm border border-[var(--line)] bg-[var(--surface-raised)]/80 p-5 backdrop-blur-sm">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">
            Command
          </h2>
          {selectedClaim ? (
            <>
              <p className="mt-4 font-display text-3xl text-[var(--ink)]">
                {selectedClaim.sector}
              </p>
              <p className="mt-2 text-sm text-[var(--ink-muted)]">
                Status:{" "}
                <span className="text-[var(--ink)]">{selectedClaim.owner}</span>
              </p>
              <button
                type="button"
                onClick={claimSelected}
                className="mt-6 inline-flex w-full items-center justify-center rounded-sm bg-[var(--signal)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--signal-bright)]"
              >
                Claim sector
              </button>
            </>
          ) : (
            <p className="mt-4 text-sm leading-relaxed text-[var(--ink-muted)]">
              Select a sector on the board to contest it. Map mode and multiplayer
              come next.
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}
