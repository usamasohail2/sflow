"use client";

import Image from "next/image";
import type { Entry } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/constants";
import { getEntryImages } from "@/lib/utils";
import { CategoryIcon } from "@/components/CategoryIcon";

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

/** Quiet placeholder when a spot has no uploaded photos */
export function EntryImageFallback({
  entry,
  className = "",
  iconClassName = "h-4 w-4",
  label = false,
}: {
  entry: Entry;
  className?: string;
  iconClassName?: string;
  label?: boolean;
}) {
  const isEvent = entry.type === "event";

  return (
    <div
      className={`relative flex h-full w-full flex-col items-center justify-center gap-1 bg-wash text-ink-faint ${className}`}
      aria-hidden
    >
      {isEvent ? (
        <EventIcon className={iconClassName} />
      ) : (
        <CategoryIcon category={entry.category} className={iconClassName} />
      )}
      {label && (
        <span className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">
          {isEvent ? "Event" : CATEGORY_LABELS[entry.category]}
        </span>
      )}
    </div>
  );
}

/** Photo when available; otherwise the category fallback */
export function EntryMedia({
  entry,
  fill = true,
  sizes,
  className = "",
  imageClassName = "object-cover",
  priority = false,
  showFallbackLabel = false,
  fallbackIconClassName,
}: {
  entry: Entry;
  fill?: boolean;
  sizes?: string;
  className?: string;
  imageClassName?: string;
  priority?: boolean;
  showFallbackLabel?: boolean;
  fallbackIconClassName?: string;
}) {
  const src = getEntryImages(entry)[0] ?? null;

  if (!src) {
    return (
      <EntryImageFallback
        entry={entry}
        className={className}
        iconClassName={fallbackIconClassName}
        label={showFallbackLabel}
      />
    );
  }

  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      <Image
        src={src}
        alt=""
        fill={fill}
        className={imageClassName}
        sizes={sizes}
        priority={priority}
      />
    </div>
  );
}
