"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Entry } from "@/lib/types";
import type { Category, ViewFilter } from "@/lib/constants";
import { EntryCard } from "./EntryCard";
import { KohMascot } from "./KohMascot";
import { QuietLoader } from "./LoadingScreen";

const STACK_MAX_STAGGER = 14;

interface EntryListProps {
  entries: Entry[];
  selectedId: string | null;
  onSelect: (entry: Entry) => void;
  loading: boolean;
  viewFilter: ViewFilter;
  /** Start stack-in after splash (page load) */
  animateIn?: boolean;
  viewedIds?: Set<string>;
  focusedCategories?: Category[];
  onAdd?: () => void;
}

function emptyCopy(): { title: string; body: string } {
  return {
    title: "No spots yet",
    body: "No places match these filters — try another category, or add a café, trail, or hangout you know.",
  };
}

export function EntryList({
  entries,
  selectedId,
  onSelect,
  loading,
  animateIn = false,
  viewedIds,
  focusedCategories = [],
  onAdd,
}: EntryListProps) {
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [stackPhase, setStackPhase] = useState<"pending" | "animating" | "done">(
    "pending"
  );

  const activeEntries = useMemo(
    () => entries.filter((e) => e.status !== "pending"),
    [entries]
  );

  useEffect(() => {
    if (
      !animateIn ||
      loading ||
      activeEntries.length === 0 ||
      stackPhase !== "pending"
    )
      return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (reduceMotion) {
      setStackPhase("done");
      return;
    }

    setStackPhase("animating");
    const n = Math.min(activeEntries.length, STACK_MAX_STAGGER + 1);
    const doneMs = 120 + n * 70 + 500;
    const t = window.setTimeout(() => setStackPhase("done"), doneMs);
    return () => window.clearTimeout(t);
  }, [animateIn, loading, activeEntries.length, stackPhase]);

  useEffect(() => {
    if (!selectedId) return;
    const el = cardRefs.current[selectedId];
    el?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [selectedId]);

  if (loading) {
    return (
      <div className="px-3 py-4">
        <QuietLoader label="Loading listings…" />
      </div>
    );
  }

  if (entries.length === 0) {
    const empty = emptyCopy();
    return (
      <div className="flex items-center gap-3 px-3 py-2">
        <KohMascot size={36} mood="look" interactive />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{empty.title}</p>
          <p className="text-[11px] leading-snug text-ink-muted">{empty.body}</p>
        </div>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="ml-auto shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-[11px] font-semibold text-ink shadow-sm"
          >
            Add
          </button>
        )}
      </div>
    );
  }

  const railEntries = activeEntries;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={scrollerRef}
        className="hide-scrollbar flex items-end gap-2 overflow-x-auto px-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {railEntries.map((entry, index) => {
          const stagger = Math.min(index, STACK_MAX_STAGGER);
          return (
            <div
              key={entry.id}
              ref={(node) => {
                cardRefs.current[entry.id] = node;
              }}
              className={`w-[100px] shrink-0 sm:w-[112px] ${
                stackPhase === "animating" ? "list-stack-item" : ""
              }`}
              style={
                stackPhase === "animating"
                  ? ({ "--stack-i": stagger } as CSSProperties)
                  : stackPhase === "pending"
                    ? { opacity: 0 }
                    : undefined
              }
            >
              <EntryCard
                entry={entry}
                variant="rail"
                isSelected={selectedId === entry.id}
                isViewed={viewedIds?.has(entry.id)}
                isDimmed={
                  focusedCategories.length > 0 &&
                  !focusedCategories.includes(entry.category)
                }
                onClick={() => onSelect(entry)}
              />
            </div>
          );
        })}

        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="flex w-[84px] shrink-0 flex-col items-center justify-center gap-0.5 self-stretch rounded-xl border border-dashed border-line-strong bg-surface/90 px-1.5 py-2 text-center shadow-sm backdrop-blur-sm transition hover:bg-wash sm:w-[96px]"
          >
            <span className="text-base leading-none text-ink-muted">+</span>
            <span className="text-[10px] font-semibold leading-tight text-ink">
              Add spot
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
