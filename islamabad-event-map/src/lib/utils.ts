import type { CityId, DateFilter } from "./constants";
import { CATEGORY_LABELS, CITY_CONFIG, DEFAULT_CITY } from "./constants";
import type { Entry } from "./types";

/** First uploaded photo, or null when the spot has no images */
export function getEntryImage(entry: Entry): string | null {
  return getEntryImages(entry)[0] ?? null;
}

/** Uploaded photos only — no stock/Unsplash fallbacks */
export function getEntryImages(entry: Entry): string[] {
  return entry.imageUrls?.length ? entry.imageUrls : [];
}

export function hasCoordinates(entry: Entry): boolean {
  return entry.lat != null && entry.lng != null;
}

function pointInBounds(
  lat: number,
  lng: number,
  bounds: [[number, number], [number, number]]
): boolean {
  const [[west, south], [east, north]] = bounds;
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

/** Infer city from coords, then location text; default Islamabad (drawings, etc.) */
export function entryCity(entry: Entry): CityId {
  if (hasCoordinates(entry)) {
    for (const id of Object.keys(CITY_CONFIG) as CityId[]) {
      if (pointInBounds(entry.lat!, entry.lng!, CITY_CONFIG[id].maxBounds)) {
        return id;
      }
    }
  }

  const haystack = [
    entry.locationText,
    entry.title,
    entry.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\blahore\b|\blhr\b/.test(haystack)) return "lahore";
  if (/\bislamabad\b|\bisb\b|\brawalpindi\b|\brwp\b/.test(haystack)) {
    return "islamabad";
  }

  return DEFAULT_CITY;
}

export function entryInCity(entry: Entry, city: CityId): boolean {
  return entryCity(entry) === city;
}

/** Nudge stacked pins so events/places at the same spot both stay visible */
export function mapPinPosition(
  entry: Entry,
  siblings: Entry[]
): { lat: number; lng: number } {
  const lat = entry.lat!;
  const lng = entry.lng!;
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const stack = siblings.filter(
    (e) =>
      e.lat != null &&
      e.lng != null &&
      `${e.lat.toFixed(5)},${e.lng.toFixed(5)}` === key
  );
  if (stack.length <= 1) return { lat, lng };

  const index = stack.findIndex((e) => e.id === entry.id);
  const angle = (index / stack.length) * Math.PI * 2 - Math.PI / 2;
  const radius = 0.0011; // ~120m — enough to separate overlapping pins
  return {
    lat: lat + Math.sin(angle) * radius,
    lng: lng + Math.cos(angle) * radius,
  };
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function isEventUpcoming(entry: Entry, today = new Date()): boolean {
  if (!entry.eventDate) return true;
  const eventDay = startOfDay(new Date(entry.eventDate));
  return eventDay >= startOfDay(today);
}

const SOON_WITHIN_DAYS = 3;

/** Days until event start (0 = today). Null if not an upcoming dated event. */
export function daysUntilEvent(
  entry: Entry,
  today = new Date()
): number | null {
  if (entry.type !== "event" || !entry.eventDate) return null;
  const eventDay = startOfDay(new Date(entry.eventDate));
  const now = startOfDay(today);
  const days = Math.round(
    (eventDay.getTime() - now.getTime()) / 86_400_000
  );
  if (days < 0) return null;
  return days;
}

export function isEventHappeningSoon(
  entry: Entry,
  today = new Date()
): boolean {
  const days = daysUntilEvent(entry, today);
  return days != null && days <= SOON_WITHIN_DAYS;
}

export function happeningSoonLabel(
  entry: Entry,
  today = new Date()
): string | null {
  const days = daysUntilEvent(entry, today);
  if (days == null || days > SOON_WITHIN_DAYS) return null;
  if (days === 0) return "Happening today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

export function matchesDateFilter(
  entry: Entry,
  filter: DateFilter,
  today = new Date()
): boolean {
  if (!entry.eventDate) return filter === "upcoming";

  const eventDay = startOfDay(new Date(entry.eventDate));
  const now = startOfDay(today);

  if (eventDay < now) return false;

  if (filter === "upcoming") return true;

  if (filter === "today") {
    return eventDay.getTime() === now.getTime();
  }

  const weekEnd = endOfWeek(today);
  return eventDay <= weekEnd;
}

function statusRank(status: Entry["status"]): number {
  // Approved first, then pending; rejected shouldn't appear
  return status === "approved" ? 0 : 1;
}

export function sortEntries(
  entries: Entry[],
  type: "all" | "event" | "place"
): Entry[] {
  const sorted = [...entries];

  if (type === "all") {
    // Events first (soonest), then places A–Z; approved before pending
    sorted.sort((a, b) => {
      if (a.type !== b.type) return a.type === "event" ? -1 : 1;
      const byStatus = statusRank(a.status) - statusRank(b.status);
      if (byStatus !== 0) return byStatus;
      if (a.type === "event") {
        if (!a.eventDate && !b.eventDate) return a.title.localeCompare(b.title);
        if (!a.eventDate) return 1;
        if (!b.eventDate) return -1;
        return new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime();
      }
      return a.title.localeCompare(b.title);
    });
    return sorted;
  }

  if (type === "event") {
    sorted.sort((a, b) => {
      const byStatus = statusRank(a.status) - statusRank(b.status);
      if (byStatus !== 0) return byStatus;
      if (!a.eventDate && !b.eventDate) return a.title.localeCompare(b.title);
      if (!a.eventDate) return 1;
      if (!b.eventDate) return -1;
      return new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime();
    });
  } else {
    sorted.sort((a, b) => {
      const byStatus = statusRank(a.status) - statusRank(b.status);
      if (byStatus !== 0) return byStatus;
      return a.title.localeCompare(b.title);
    });
  }

  return sorted;
}

function hasClockTime(iso: string): boolean {
  return /T\d{2}:\d{2}/.test(iso);
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-PK", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function daySpan(start: Date, end: Date): number {
  const ms = startOfDay(end).getTime() - startOfDay(start).getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

export function formatEventDate(entry: Entry): string | null {
  if (!entry.eventDate) return null;

  const start = new Date(entry.eventDate);
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  };

  if (entry.eventEndDate) {
    const end = new Date(entry.eventEndDate);
    if (end.toDateString() !== start.toDateString()) {
      return `${start.toLocaleDateString("en-PK", options)} – ${end.toLocaleDateString("en-PK", options)}`;
    }
  }

  return start.toLocaleDateString("en-PK", options);
}

/** Optional `Time: …` / `Contact: …` / `Organizer: …` lines in description */
function extractMetaLine(description: string | undefined, key: string): string | null {
  if (!description) return null;
  const match = description.match(new RegExp(`^${key}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() || null;
}

function extractEventTime(entry: Entry): string | null {
  return extractMetaLine(entry.description, "Time");
}

export function entryContactPhone(entry: Entry): string | undefined {
  if (entry.contactPhone?.trim()) return entry.contactPhone.trim();
  return extractMetaLine(entry.description, "Contact") ?? undefined;
}

export function entryOrganizerName(entry: Entry): string {
  if (entry.organizerName?.trim()) return entry.organizerName.trim();
  return extractMetaLine(entry.description, "Organizer") ?? "";
}

/** Description without metadata lines (Time / Contact / Organizer) */
export function entryBodyText(entry: Entry): string | undefined {
  if (!entry.description) return undefined;
  const cleaned = entry.description
    .replace(/^Time:\s*.+$/im, "")
    .replace(/^Contact:\s*.+$/im, "")
    .replace(/^Organizer:\s*.+$/im, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned || undefined;
}

/** Card-friendly schedule: date + time, or multi-day duration */
export function formatEventSchedule(entry: Entry): string | null {
  if (!entry.eventDate) return null;

  const start = new Date(entry.eventDate);
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
  };
  const timeNote = extractEventTime(entry);

  if (entry.eventEndDate) {
    const end = new Date(entry.eventEndDate);
    if (end.toDateString() !== start.toDateString()) {
      const days = daySpan(start, end);
      const range = `${start.toLocaleDateString("en-PK", dateOpts)} – ${end.toLocaleDateString("en-PK", dateOpts)}`;
      return timeNote ? `${range} · ${timeNote}` : `${range} · ${days} days`;
    }

    if (hasClockTime(entry.eventDate) || hasClockTime(entry.eventEndDate)) {
      const date = start.toLocaleDateString("en-PK", dateOpts);
      return `${date} · ${formatClock(start)} – ${formatClock(end)}`;
    }
  }

  const date = start.toLocaleDateString("en-PK", dateOpts);
  if (hasClockTime(entry.eventDate)) {
    return `${date} · ${formatClock(start)}`;
  }
  if (timeNote) return `${date} · ${timeNote}`;

  return date;
}

/** Short date for map pills, e.g. "Jul 15" */
export function formatShortDate(entry: Entry): string | null {
  if (!entry.eventDate) return null;
  const d = new Date(entry.eventDate);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Airbnb-style map pin label */
export function pinLabel(entry: Entry): string {
  if (entry.type === "event") {
    return formatShortDate(entry) ?? CATEGORY_LABELS[entry.category];
  }
  return CATEGORY_LABELS[entry.category];
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + "…";
}
