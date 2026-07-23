"use client";

import Image from "next/image";
import type { Entry } from "@/lib/types";
import {
  formatEventSchedule,
  getEntryImage,
  happeningSoonLabel,
  isEventHappeningSoon,
} from "@/lib/utils";
import { CategoryIcon, categoryColor } from "@/components/CategoryIcon";

interface EntryCardProps {
  entry: Entry;
  isSelected: boolean;
  isViewed?: boolean;
  /** Strongly dulled when outside the focused categories */
  isDimmed?: boolean;
  /** Compact vertical card for the horizontal bottom rail */
  variant?: "row" | "rail";
  onClick: () => void;
}

function EventIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="3.5"
        y="5"
        width="17"
        height="15"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M3.5 10h17"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M8 3.5v3.5M16 3.5v3.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EntryCard({
  entry,
  isSelected,
  isViewed = false,
  isDimmed = false,
  variant = "row",
  onClick,
}: EntryCardProps) {
  const isEvent = entry.type === "event";
  const schedule = formatEventSchedule(entry);
  const image = getEntryImage(entry);
  const soon = isEvent && isEventHappeningSoon(entry);
  const soonLabel = soon ? happeningSoonLabel(entry) : null;
  const isPending = entry.status === "pending";
  const showViewed = isViewed && !isSelected && !isDimmed;

  const tone = `${
    isPending
      ? isSelected
        ? "entry-card-pending-selected border-transparent"
        : "entry-card-pending"
      : isSelected
        ? isEvent
          ? "entry-card-event-selected border-transparent"
          : "btn-primary btn-primary-selected border-transparent"
        : isEvent
          ? "entry-card-event"
          : "entry-card-place"
  } ${
    isDimmed && !isSelected
      ? "opacity-[0.55] saturate-[0.6]"
      : showViewed
        ? "opacity-95 saturate-95"
        : ""
  }`;

  if (variant === "rail") {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`group flex w-full flex-col overflow-hidden rounded-xl border text-left shadow-sm backdrop-blur-sm transition ${tone}`}
      >
        <div className="relative aspect-[5/4] w-full overflow-hidden bg-line">
          <Image
            src={image}
            alt=""
            fill
            className={`object-cover transition duration-300 group-hover:scale-[1.03] ${
              isPending ? "opacity-85 saturate-[0.7]" : ""
            }`}
            sizes="120px"
          />
          <span
            className={`absolute left-1 top-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-white shadow-sm ${
              isPending
                ? "bg-[var(--pending)]"
                : isEvent
                  ? "bg-[var(--orange)]"
                  : ""
            }`}
            style={
              !isPending && !isEvent
                ? { backgroundColor: categoryColor(entry.category) }
                : undefined
            }
            aria-hidden
          >
            {isEvent ? (
              <EventIcon className="h-2 w-2" />
            ) : (
              <CategoryIcon
                category={entry.category}
                className="h-2 w-2"
              />
            )}
          </span>
        </div>
        <div className="bg-surface/90 px-1.5 py-1">
          {isPending && (
            <span
              className={`pending-badge mb-0.5 text-[8px] ${
                isSelected ? "pending-badge-on-dark" : ""
              }`}
            >
              Review
            </span>
          )}
          {soonLabel && (
            <span
              className={`soon-badge mb-0.5 text-[8px] ${
                isSelected ? "soon-badge-on-dark" : ""
              }`}
            >
              <span className="soon-badge-dot" aria-hidden />
              {soonLabel}
            </span>
          )}
          <h3
            className={`truncate text-[10px] font-semibold leading-snug ${
              isSelected ? "text-white" : "text-ink"
            }`}
          >
            {entry.title}
          </h3>
          {isEvent && (
            <p
              className={`mt-0.5 truncate text-[9px] font-medium ${
                isSelected ? "text-white/90" : "text-ink-muted"
              }`}
            >
              {schedule ?? "Date TBA"}
            </p>
          )}
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-1.5 rounded-none border p-1 text-left transition sm:gap-2 sm:p-1.5 ${tone}`}
    >
      <div className="relative h-9 w-11 shrink-0 overflow-hidden rounded-none bg-line sm:h-10 sm:w-12">
        <Image
          src={image}
          alt=""
          fill
          className={`object-cover transition duration-300 group-hover:scale-[1.03] ${
            isPending ? "opacity-85 saturate-[0.7]" : ""
          }`}
          sizes="48px"
        />
        <span
          className={`absolute left-0.5 top-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-white shadow-sm sm:h-4 sm:w-4 ${
            isPending
              ? "bg-[var(--pending)]"
              : isEvent
                ? "bg-[var(--orange)]"
                : ""
          }`}
          style={
            !isPending && !isEvent
              ? { backgroundColor: categoryColor(entry.category) }
              : undefined
          }
          aria-hidden
        >
          {isEvent ? (
            <EventIcon className="h-2 w-2 sm:h-2.5 sm:w-2.5" />
          ) : (
            <CategoryIcon
              category={entry.category}
              className="h-2 w-2 sm:h-2.5 sm:w-2.5"
            />
          )}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1">
          {isPending && (
            <span
              className={`pending-badge text-[9px] ${
                isSelected ? "pending-badge-on-dark" : ""
              }`}
            >
              Awaiting review
            </span>
          )}
          {soonLabel && (
            <span
              className={`soon-badge text-[9px] ${isSelected ? "soon-badge-on-dark" : ""}`}
            >
              <span className="soon-badge-dot" aria-hidden />
              {soonLabel}
            </span>
          )}
        </div>

        <h3
          className={`line-clamp-2 text-[11px] font-semibold leading-snug sm:text-xs ${
            isSelected ? "text-white" : "text-ink"
          }`}
        >
          {entry.title}
        </h3>

        {isEvent && (
          <p
            className={`mt-0.5 flex items-center gap-0.5 truncate text-[10px] font-medium sm:text-[11px] ${
              isSelected
                ? "text-white/90"
                : isPending
                  ? "text-[var(--pending-deep)]"
                  : "entry-meta-event"
            }`}
          >
            <EventIcon className="h-2.5 w-2.5 shrink-0 opacity-80" />
            <span className="truncate">{schedule ?? "Date TBA"}</span>
          </p>
        )}

        {entry.sourceUrl && (
          <a
            href={entry.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`mt-0.5 inline-block text-[10px] font-medium underline-offset-2 hover:underline ${
              isSelected ? "text-white" : "text-ink"
            }`}
          >
            Source
          </a>
        )}
      </div>
    </button>
  );
}
