"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CityId } from "@/lib/constants";

export type GeocodedPlace = {
  id: string;
  name: string;
  placeName: string;
  lat: number;
  lng: number;
  bbox?: [number, number, number, number];
};

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

async function geocodePlaces(
  query: string,
  city: CityId
): Promise<GeocodedPlace[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const params = new URLSearchParams({ q, city });
  const res = await fetch(`/api/geocode?${params}`);
  if (!res.ok) return [];

  const data = (await res.json()) as { places?: GeocodedPlace[] };
  return Array.isArray(data.places) ? data.places : [];
}

/**
 * Top-chrome place search: magnifying glass → world location search
 * so you can jump the map and pin more easily.
 */
export function PlaceSearch({
  city,
  onSelectPlace,
  className = "",
}: {
  city: CityId;
  onSelectPlace: (place: GeocodedPlace) => void;
  className?: string;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodedPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    const t = window.setTimeout(() => {
      void geocodePlaces(q, city)
        .then((places) => {
          if (cancelled) return;
          setResults(places);
          setActiveIndex(0);
          setLoading(false);
          if (places.length === 0) setError("No places found");
        })
        .catch(() => {
          if (cancelled) return;
          setResults([]);
          setLoading(false);
          setError("Search failed");
        });
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, city, open]);

  const pick = (place: GeocodedPlace) => {
    onSelectPlace(place);
    setQuery(place.name);
    setResults([]);
    setOpen(false);
  };

  const close = () => {
    setOpen(false);
    setResults([]);
    setError(null);
  };

  return (
    <div
      ref={rootRef}
      className={`pointer-events-auto relative h-9 w-9 shrink-0 ${className}`}
    >
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Search places on the map"
          aria-expanded={false}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-sm transition hover:bg-wash"
        >
          <SearchIcon className="h-4 w-4" />
        </button>
      ) : (
        <div className="absolute right-0 top-0 z-40">
          <label htmlFor={id} className="sr-only">
            Search places worldwide
          </label>
          <div
            className="flex h-9 w-[min(78vw,18rem)] items-center overflow-hidden rounded-full border border-line bg-surface shadow-sm sm:w-[20rem]"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-haspopup="listbox"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center text-ink-muted">
              <SearchIcon className="h-4 w-4" />
            </span>
            <input
              ref={inputRef}
              id={id}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  if (query) {
                    setQuery("");
                    setResults([]);
                  } else {
                    close();
                  }
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIndex((i) =>
                    results.length === 0
                      ? 0
                      : Math.min(i + 1, results.length - 1)
                  );
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  const choice = results[activeIndex] ?? results[0];
                  if (choice) pick(choice);
                }
              }}
              placeholder="Search places…"
              autoComplete="off"
              enterKeyHint="search"
              className="min-w-0 flex-1 bg-transparent py-1.5 pr-1 text-[12px] text-ink outline-none placeholder:text-ink-faint"
            />
            <button
              type="button"
              onClick={() => {
                if (query) {
                  setQuery("");
                  setResults([]);
                  inputRef.current?.focus();
                } else {
                  close();
                }
              }}
              aria-label={query ? "Clear search" : "Close search"}
              className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition hover:bg-wash hover:text-ink"
            >
              <ClearIcon className="h-3 w-3" />
            </button>
          </div>

          {(loading || error || results.length > 0) && (
            <div className="mt-1.5 w-[min(78vw,18rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-sm sm:w-[20rem]">
              {loading ? (
                <p className="px-3 py-2 text-[11px] text-ink-muted">
                  Searching…
                </p>
              ) : results.length > 0 ? (
                <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
                  {results.map((place, index) => (
                    <li
                      key={place.id}
                      role="option"
                      aria-selected={index === activeIndex}
                    >
                      <button
                        type="button"
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => pick(place)}
                        className={`flex w-full flex-col items-start px-3 py-2 text-left transition ${
                          index === activeIndex ? "bg-wash" : "hover:bg-wash"
                        }`}
                      >
                        <span className="text-[12px] font-semibold text-ink">
                          {place.name}
                        </span>
                        <span className="mt-0.5 line-clamp-1 text-[10px] text-ink-muted">
                          {place.placeName}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : error ? (
                <p className="px-3 py-2 text-[11px] text-ink-muted">{error}</p>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
