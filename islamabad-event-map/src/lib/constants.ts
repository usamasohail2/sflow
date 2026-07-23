export const CATEGORIES = ["hidden", "food"] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  hidden: "Hidden",
  food: "Food",
};

/** Distinct colors per spot/event category (map pins, badges) */
export const CATEGORY_COLORS: Record<Category, string> = {
  hidden: "#7B2CBF",
  food: "#E85D04",
};

/** Map old Airtable / localStorage values onto the current categories */
export function normalizeCategory(value: unknown): Category {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if ((CATEGORIES as readonly string[]).includes(raw)) {
    return raw as Category;
  }

  const legacy: Record<string, Category> = {
    scenic: "hidden",
    activity: "hidden",
    nature: "hidden",
    culture: "hidden",
    art: "hidden",
    nightlife: "hidden",
    sports: "hidden",
    kids: "hidden",
    music: "hidden",
    education: "hidden",
    shopping: "hidden",
    other: "hidden",
  };
  return legacy[raw] ?? "hidden";
}

/** Map pins — candy palette, slightly deeper for map contrast */
export const MAP_PIN_COLORS = {
  event: "#F06A8D",
  place: "#4BA8E8",
  pending: "#E8B43A",
} as const;

/** Per-category pin colors — candy tones, a notch darker than before */
export const MAP_CATEGORY_PIN_COLORS: Record<Category, string> = {
  hidden: "#A78BE8",
  food: "#F07A55",
};

export const ISLAMABAD_CENTER = {
  lat: 33.6844,
  lng: 73.0479,
};

export const LAHORE_CENTER = {
  lat: 31.5204,
  lng: 74.3587,
};

export const DEFAULT_ZOOM = 12;

/**
 * Soft box around Islamabad Capital Territory + Rawalpindi metro
 * (Margallas → south RWP, west to Golra / Bahria approach, east to Bhara Kahu).
 * Format: [[west, south], [east, north]] for Mapbox maxBounds.
 */
export const MAP_MAX_BOUNDS: [[number, number], [number, number]] = [
  [72.8, 33.46],
  [73.32, 33.84],
];

/**
 * Soft box around Lahore metro
 * (Ravi → southeast DHA/Cantt approach, west toward Shahdara, east toward BRB canal).
 */
export const LAHORE_MAX_BOUNDS: [[number, number], [number, number]] = [
  [74.12, 31.28],
  [74.55, 31.7],
];

/** Keep the view filled with the twin cities — not the whole country */
export const MAP_MIN_ZOOM = 10.5;
export const MAP_MAX_ZOOM = 18;

export const CITIES = ["islamabad", "lahore"] as const;
export type CityId = (typeof CITIES)[number];

export interface CityConfig {
  id: CityId;
  label: string;
  shortLabel: string;
  center: { lat: number; lng: number };
  maxBounds: [[number, number], [number, number]];
  defaultZoom: number;
  minZoom: number;
}

export const CITY_CONFIG: Record<CityId, CityConfig> = {
  islamabad: {
    id: "islamabad",
    label: "Islamabad",
    shortLabel: "Isb",
    center: ISLAMABAD_CENTER,
    maxBounds: MAP_MAX_BOUNDS,
    defaultZoom: DEFAULT_ZOOM,
    minZoom: MAP_MIN_ZOOM,
  },
  lahore: {
    id: "lahore",
    label: "Lahore",
    shortLabel: "Lhr",
    center: LAHORE_CENTER,
    maxBounds: LAHORE_MAX_BOUNDS,
    defaultZoom: 11.5,
    minZoom: 10,
  },
};

export const DEFAULT_CITY: CityId = "islamabad";

/** Flat top-down view */
export const MAP_2D_PITCH = 0;
/** Tilted perspective for 3D buildings and terrain */
export const MAP_3D_PITCH = 77;
export const MAX_MAP_PITCH = 85;
/** Resting / reset heading — matches preferred Centaurus-area view */
export const DEFAULT_MAP_BEARING = -28;

/** Launch fly-through — path lives in launchCameraTrack.ts (baked keyframes) */
export interface MapCameraView {
  lng: number;
  lat: number;
  zoom: number;
}

export const LAUNCH_CAMERA = {
  pitch: MAP_3D_PITCH,
  bearing: DEFAULT_MAP_BEARING,
  durationMs: 10000,
  /** Opening frame — matches LAUNCH_CAMERA_TRACK[0] */
  start: {
    lng: 73.0372,
    lat: 33.7299,
    zoom: 16.5,
  } satisfies MapCameraView,
  /** Closing frame — matches last baked keyframe */
  end: {
    lng: 73.0897,
    lat: 33.6427,
    zoom: 11.74,
  } satisfies MapCameraView,
} as const;

export type EntryType = "event" | "place";

/** Explore page filter — spots-only in the UI (event type still exists in data) */
export type ViewFilter = EntryType;

export type DateFilter = "today" | "week" | "upcoming";

export const DATE_FILTER_LABELS: Record<DateFilter, string> = {
  today: "Today",
  week: "This Week",
  upcoming: "All Upcoming",
};
