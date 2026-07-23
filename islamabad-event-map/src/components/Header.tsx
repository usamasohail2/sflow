"use client";

import Link from "next/link";
import { DarkModeToggle } from "./DarkModeToggle";
import type { CityId, ViewFilter } from "@/lib/constants";
import { CITY_CONFIG } from "@/lib/constants";

function MapLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden
    >
      <rect width="40" height="40" rx="12" fill="var(--blue)" />
      <path
        d="M10 14.5 17 12l6.5 2.5L30 12.2v15.3L23.5 30 17 27.5 10 30V14.5Z"
        stroke="white"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M17 12v15.5M23.5 14.5V30"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="20" cy="21" r="2.6" fill="white" />
    </svg>
  );
}

function listingCountLabel(count: number): string {
  return `${count} spot${count !== 1 ? "s" : ""}`;
}

function CityToggle({
  city,
  onCityChange,
}: {
  city: CityId;
  onCityChange: (city: CityId) => void;
}) {
  const isLahore = city === "lahore";

  return (
    <div
      className="flex shrink-0 items-center gap-1.5"
      role="group"
      aria-label="City"
    >
      <span
        className={`text-[10px] font-semibold tabular-nums transition-colors ${
          !isLahore ? "text-ink" : "text-ink-faint"
        }`}
      >
        {CITY_CONFIG.islamabad.shortLabel}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={isLahore}
        aria-label={
          isLahore ? "Switch to Islamabad" : "Switch to Lahore"
        }
        title={isLahore ? "Switch to Islamabad" : "Switch to Lahore"}
        onClick={() => onCityChange(isLahore ? "islamabad" : "lahore")}
        className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
          isLahore
            ? "border-[var(--blue)] bg-[var(--blue)]"
            : "border-line-strong bg-wash"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
            isLahore ? "left-[1.125rem]" : "left-0.5"
          }`}
        />
      </button>
      <span
        className={`text-[10px] font-semibold tabular-nums transition-colors ${
          isLahore ? "text-ink" : "text-ink-faint"
        }`}
      >
        {CITY_CONFIG.lahore.shortLabel}
      </span>
    </div>
  );
}

interface HeaderProps {
  /** Compact brand bar for the top of the app shell */
  variant?: "bar" | "sidebar";
  listingCount?: number;
  viewFilter?: ViewFilter;
  /** When false, only the brand link is shown (for centered map chrome) */
  showThemeToggle?: boolean;
  city?: CityId;
  onCityChange?: (city: CityId) => void;
}

export function Header({
  variant = "bar",
  listingCount,
  showThemeToggle = true,
  city = "islamabad",
  onCityChange,
}: HeaderProps) {
  const cityLabel = CITY_CONFIG[city].label;

  if (variant === "sidebar") {
    return (
      <header className="shrink-0 bg-transparent px-2.5 py-1.5">
        <div
          className={`flex items-center gap-2 ${
            showThemeToggle ? "justify-between" : "justify-center"
          }`}
        >
          <Link
            href="/"
            className="flex min-w-0 items-center gap-1.5"
            aria-label={`${cityLabel} Explore home`}
          >
            <MapLogo className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
            <span className="min-w-0 leading-tight">
              <span className="flex flex-wrap items-baseline justify-center gap-x-1 gap-y-0">
                <span className="text-[11px] font-semibold tracking-tight text-ink sm:text-xs">
                  {cityLabel} Explore
                </span>
                {listingCount != null && (
                  <span className="text-[10px] font-medium tabular-nums text-ink-muted">
                    · {listingCountLabel(listingCount)}
                  </span>
                )}
              </span>
            </span>
          </Link>
          {onCityChange && (
            <CityToggle city={city} onCityChange={onCityChange} />
          )}
          {showThemeToggle && (
            <div className="shrink-0">
              <DarkModeToggle />
            </div>
          )}
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur-sm">
      <div className="mx-auto flex h-[72px] max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5"
          aria-label={`${cityLabel} Explore home`}
        >
          <MapLogo className="h-10 w-10 shrink-0" />
          <span className="leading-tight">
            <span className="block text-base font-semibold tracking-tight text-ink sm:text-lg">
              {cityLabel} Explore
            </span>
            <span className="mt-0.5 block text-xs font-medium text-ink-muted">
              Community map of spots in {cityLabel}
            </span>
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-3">
          {onCityChange && (
            <CityToggle city={city} onCityChange={onCityChange} />
          )}
          <DarkModeToggle />
        </div>
      </div>
    </header>
  );
}
