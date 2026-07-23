"use client";

import { useEffect, useId, useRef, useState } from "react";

function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16.5 16.5 21 21" />
    </svg>
  );
}

function ClearIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/**
 * Top-chrome search: magnifying glass that expands into a field on click.
 */
export function SpotSearch({
  value,
  onChange,
  resultCount,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  /** When searching, show how many spots matched */
  resultCount?: number;
  className?: string;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searching = value.trim().length > 0;
  const [open, setOpen] = useState(false);
  const expanded = open || searching;

  useEffect(() => {
    if (!expanded) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        if (!searching) setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (value) {
        onChange("");
        return;
      }
      setOpen(false);
      inputRef.current?.blur();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded, searching, value, onChange]);

  return (
    <div
      ref={rootRef}
      className={`pointer-events-auto relative h-9 w-9 shrink-0 ${className}`}
    >
      {!expanded ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Search spots"
          aria-expanded={false}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-sm transition hover:bg-wash"
        >
          <SearchIcon className="h-4 w-4" />
        </button>
      ) : (
        <div className="absolute right-0 top-0 z-20">
          <label htmlFor={id} className="sr-only">
            Search spots
          </label>
          <div
            className="flex h-9 w-[min(72vw,16.5rem)] items-center overflow-hidden rounded-full border border-line bg-surface shadow-sm sm:w-[18rem]"
            role="search"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center text-ink-muted">
              <SearchIcon className="h-4 w-4" />
            </span>
            <input
              ref={inputRef}
              id={id}
              type="search"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  if (value) onChange("");
                  else {
                    setOpen(false);
                    inputRef.current?.blur();
                  }
                }
              }}
              placeholder="Search spots…"
              autoComplete="off"
              enterKeyHint="search"
              aria-expanded={true}
              className="min-w-0 flex-1 bg-transparent py-1.5 pr-1 text-[12px] text-ink outline-none placeholder:text-ink-faint"
            />
            <button
              type="button"
              onClick={() => {
                if (value) onChange("");
                else setOpen(false);
              }}
              aria-label={value ? "Clear search" : "Close search"}
              className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition hover:bg-wash hover:text-ink"
            >
              <ClearIcon className="h-3 w-3" />
            </button>
          </div>
          {searching && typeof resultCount === "number" ? (
            <p className="mt-1 px-1 text-right text-[10px] font-medium text-ink-muted">
              {resultCount === 0
                ? "No matches"
                : `${resultCount} spot${resultCount === 1 ? "" : "s"}`}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
