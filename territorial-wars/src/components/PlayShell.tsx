"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SectorMap } from "@/components/SectorMap";
import { islamabadSectors } from "@/lib/sectors";

type Owner = "you" | "rival" | "neutral";

type Claim = {
  sector: string;
  owner: Owner;
};

function initialClaims(): Claim[] {
  return islamabadSectors.features.map((f, i) => ({
    sector: f.properties.id,
    owner: (i % 7 === 0 ? "rival" : i % 5 === 0 ? "you" : "neutral") as Owner,
  }));
}

export function PlayShell() {
  const [claims, setClaims] = useState<Claim[]>(initialClaims);
  const [selected, setSelected] = useState<string | null>(null);

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
    <main className="flex min-h-[100dvh] flex-col bg-[var(--surface)]">
      <header className="relative z-20 flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface-raised)]/90 px-4 py-3 backdrop-blur-sm sm:px-6">
        <div>
          <Link
            href="/"
            className="font-display text-sm tracking-tight text-[var(--ink)] sm:text-base"
          >
            Islamabad Territorial Wars
          </Link>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
            Sector walls · E–I grid
          </p>
        </div>
        <p className="font-mono text-[11px] text-[var(--sand)]">
          Held <span className="text-[var(--ink)]">{yourCount}</span>/
          {claims.length}
        </p>
      </header>

      <div className="relative grid min-h-0 flex-1 lg:grid-cols-[1fr_20rem]">
        <SectorMap
          selectedId={selected}
          onSelect={setSelected}
          className="min-h-[55vh] w-full lg:min-h-0 lg:h-full"
        />

        <aside className="border-t border-[var(--line)] bg-[var(--surface-raised)] p-5 lg:border-l lg:border-t-0">
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
              <p className="mt-3 text-sm leading-relaxed text-[var(--ink-muted)]">
                Each sector is walled on all four edges. Tap another sector on
                the map to inspect its boundary.
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
              Tap any walled sector on the Islamabad grid. Walls mark every
              sector boundary individually (E–I × 5–12).
            </p>
          )}

          <ul className="mt-8 space-y-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">
            <li>
              <span className="inline-block h-2 w-2 bg-[#c4b089]" /> F row
            </li>
            <li>
              <span className="inline-block h-2 w-2 bg-[#e23b2f]" /> G row
            </li>
            <li>
              <span className="inline-block h-2 w-2 bg-[#5a9a63]" /> E row
            </li>
            <li>
              <span className="inline-block h-2 w-2 bg-[#6a8caf]" /> H row
            </li>
            <li>
              <span className="inline-block h-2 w-2 bg-[#b07d4f]" /> I row
            </li>
          </ul>
        </aside>
      </div>
    </main>
  );
}
