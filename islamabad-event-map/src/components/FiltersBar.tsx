"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Category, DateFilter, ViewFilter } from "@/lib/constants";
import { CATEGORY_LABELS, DATE_FILTER_LABELS } from "@/lib/constants";
import { CategoryIcon, categoryColor } from "@/components/CategoryIcon";

type PanelPhase = "closed" | "open" | "closing";

interface FiltersBarProps {
  viewFilter: ViewFilter;
  onViewFilterChange: (filter: ViewFilter) => void;
  selectedCategories: Category[];
  onCategoriesChange: (categories: Category[]) => void;
  dateFilter: DateFilter;
  onDateFilterChange: (filter: DateFilter) => void;
  availableCategories: Category[];
  eventCount?: number;
  placeCount?: number;
  /** Float over the map instead of sitting in the sidebar */
  floating?: boolean;
}

export function FiltersBar({
  viewFilter,
  onViewFilterChange,
  selectedCategories,
  onCategoriesChange,
  dateFilter,
  onDateFilterChange,
  availableCategories,
  placeCount = 0,
  floating = false,
}: FiltersBarProps) {
  const [panelPhase, setPanelPhase] = useState<PanelPhase>("closed");
  const [panelVisible, setPanelVisible] = useState(false);
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const open = panelPhase === "open";

  const openPanel = () => {
    setPanelPhase("open");
    // Next frame so CSS can transition from closed → open
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setPanelVisible(true));
    });
  };

  const closePanel = () => {
    setPanelVisible(false);
    setPanelPhase("closing");
  };

  const togglePanel = () => {
    if (panelPhase === "open") closePanel();
    else if (panelPhase === "closed") openPanel();
  };

  const toggleCategory = (category: Category) => {
    onCategoriesChange([category]);
  };

  const segments: { id: ViewFilter; label: string; count: number }[] = [
    { id: "place", label: "Spots", count: placeCount },
  ];

  const showDate = false;
  const activeFilterCount =
    selectedCategories.length + (showDate && dateFilter !== "upcoming" ? 1 : 0);
  const hasFilters = activeFilterCount > 0;

  useEffect(() => {
    if (panelPhase !== "open") return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      closePanel();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelPhase]);

  useEffect(() => {
    if (panelPhase !== "closing") return;
    const t = window.setTimeout(() => {
      setPanelPhase("closed");
    }, 200);
    return () => window.clearTimeout(t);
  }, [panelPhase]);

  const resetFilters = () => {
    onCategoriesChange([]);
    if (showDate) onDateFilterChange("upcoming");
  };

  return (
    <div
      className={
        floating
          ? "relative w-fit max-w-full"
          : "relative border-b border-line bg-surface px-3 py-3 sm:px-4"
      }
    >
      <div
        className={
          floating
            ? "flex w-fit max-w-full items-center gap-1.5 rounded-full border border-line bg-surface/95 p-1 shadow-lg backdrop-blur-sm dark:bg-surface-raised/95"
            : "flex items-center gap-2"
        }
      >
        <div
          className="seg-track flex shrink-0 gap-0.5 rounded-full p-0.5"
          role="tablist"
          aria-label="Listing type"
        >
          {segments.map((seg) => {
            const active = viewFilter === seg.id;
            const activeClass =
              seg.id === "event"
                ? "bg-[var(--orange)] text-white shadow-sm"
                : "bg-[var(--blue)] text-white shadow-sm";
            return (
              <button
                key={seg.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onViewFilterChange(seg.id)}
                className={`relative rounded-full px-2.5 py-1.5 text-center text-sm font-semibold transition-colors sm:px-3 ${
                  active ? activeClass : "seg-tab"
                }`}
              >
                {seg.label}
                <span
                  className={`ml-1 tabular-nums ${
                    active ? "text-white/80" : "text-ink-faint"
                  }`}
                >
                  {seg.count}
                </span>
              </button>
            );
          })}
        </div>

        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label="Filters"
          onClick={togglePanel}
          className={`relative shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
            open || hasFilters || panelPhase === "closing"
              ? "btn-secondary-active"
              : "btn-secondary"
          }`}
        >
          <FilterIcon />
          {hasFilters && (
            <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--blue)] px-1 text-[10px] font-bold tabular-nums text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {panelPhase !== "closed" && (
        <div
          ref={panelRef}
          id={panelId}
          className={`filters-panel ${
            panelVisible ? "filters-panel-open" : ""
          } ${
            floating
              ? "absolute left-1/2 top-[calc(100%+6px)] z-30 w-[min(92vw,320px)] -translate-x-1/2 rounded-xl border border-line-strong bg-surface p-3 shadow-lg"
              : "absolute left-2 right-2 top-[calc(100%-2px)] z-30 rounded-xl border border-line-strong bg-surface p-3 shadow-lg sm:left-3 sm:right-3"
          }`}
        >
          {showDate && (
            <div className="mb-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                When
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(DATE_FILTER_LABELS) as DateFilter[]).map(
                  (filter) => {
                    const active = dateFilter === filter;
                    return (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => onDateFilterChange(filter)}
                        className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                          active
                            ? "chip-selected"
                            : "border-line-strong text-ink-muted hover:border-ink-faint hover:text-ink"
                        }`}
                      >
                        {DATE_FILTER_LABELS[filter]}
                      </button>
                    );
                  }
                )}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Category
            </p>
            {availableCategories.length === 0 ? (
              <p className="text-sm text-ink-faint">No categories yet</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {availableCategories.map((category) => {
                  const selected = selectedCategories.includes(category);
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => toggleCategory(category)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                        selected
                          ? "border-transparent text-white"
                          : "border-line-strong text-ink-muted hover:border-ink-faint hover:text-ink"
                      }`}
                      style={
                        selected
                          ? { backgroundColor: categoryColor(category) }
                          : undefined
                      }
                    >
                      <CategoryIcon
                        category={category}
                        className="h-3.5 w-3.5"
                      />
                      {CATEGORY_LABELS[category]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5">
            <button
              type="button"
              onClick={resetFilters}
              disabled={!hasFilters}
              className="text-sm text-ink-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={closePanel}
              className="btn-primary rounded-full border px-3.5 py-1.5 text-sm font-semibold"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <path
        d="M2 3.5h12M4.5 8h7M6.5 12.5h3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
