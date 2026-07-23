"use client";

import { useId } from "react";

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
  const searching = value.trim().length > 0;

  return (
    <div className={`pointer-events-auto ${className}`}>
      <label htmlFor={id} className="sr-only">
        Search spots
      </label>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
        <input
          id={id}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && value) {
              e.preventDefault();
              onChange("");
            }
          }}
          placeholder="Search spots…"
          autoComplete="off"
          enterKeyHint="search"
          className="w-full rounded-full border border-line bg-surface py-2 pl-8 pr-8 text-[12px] text-ink outline-none placeholder:text-ink-faint shadow-sm focus:border-[var(--blue)]"
        />
        {searching ? (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition hover:bg-wash hover:text-ink"
          >
            <ClearIcon className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      {searching && typeof resultCount === "number" ? (
        <p className="mt-1 px-1 text-[10px] font-medium text-ink-muted">
          {resultCount === 0
            ? "No matches"
            : `${resultCount} spot${resultCount === 1 ? "" : "s"}`}
        </p>
      ) : null}
    </div>
  );
}
