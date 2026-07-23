"use client";

import { useEffect } from "react";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/constants";
import { CategoryIcon, categoryColor } from "@/components/CategoryIcon";

const SEEN_KEY = "isb-explore-interests-seen";
const INTERESTS_KEY = "isb-explore-interests";

export function hasSeenInterests(): boolean {
  try {
    if (localStorage.getItem(SEEN_KEY) !== "1") return false;
    return loadSavedInterests().length > 0;
  } catch {
    return true;
  }
}

export function markInterestsSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // ignore
  }
}

export function loadSavedInterests(): Category[] {
  try {
    const raw = localStorage.getItem(INTERESTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is Category =>
        typeof c === "string" && (CATEGORIES as readonly string[]).includes(c)
    );
  } catch {
    return [];
  }
}

export function saveInterests(categories: Category[]) {
  try {
    localStorage.setItem(INTERESTS_KEY, JSON.stringify(categories));
  } catch {
    // ignore
  }
}

interface InterestsModalProps {
  open: boolean;
  onContinue: (categories: Category[]) => void;
}

export function InterestsModal({ open, onContinue }: InterestsModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const choose = (category: Category) => {
    saveInterests([category]);
    markInterestsSeen();
    onContinue([category]);
  };

  return (
    <div
      className="fixed inset-0 z-[75] flex items-end justify-center bg-ink/45 p-3 backdrop-blur-[2px] sm:items-center sm:p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="interests-title"
        className="w-full max-w-md rounded-2xl border border-line bg-surface shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-4 sm:px-5 sm:py-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Islamabad Explore
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted sm:text-[15px]">
            A collection of Islamabad&apos;s best spots and hidden gems curated
            by the community.
          </p>
          <h2
            id="interests-title"
            className="mt-3 text-lg font-semibold leading-snug tracking-tight text-ink sm:text-xl"
          >
            What would you like to discover today?
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-2.5 px-4 pb-5 sm:gap-3 sm:px-5 sm:pb-6">
          {CATEGORIES.map((category) => {
            const color = categoryColor(category);
            return (
              <button
                key={category}
                type="button"
                onClick={() => choose(category)}
                className="flex flex-col items-start gap-3 rounded-2xl border border-line-strong bg-surface px-3.5 py-4 text-left text-ink transition sm:px-4 sm:py-5"
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = color;
                  e.currentTarget.style.color = "#fff";
                  e.currentTarget.style.borderColor = "transparent";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "";
                  e.currentTarget.style.color = "";
                  e.currentTarget.style.borderColor = "";
                }}
              >
                <span
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: color }}
                >
                  <CategoryIcon category={category} className="h-5 w-5" />
                </span>
                <span className="text-base font-semibold tracking-tight">
                  {CATEGORY_LABELS[category]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
