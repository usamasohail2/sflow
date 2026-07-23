"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Map, {
  Marker,
  Popup,
  AttributionControl,
} from "react-map-gl/mapbox";
import type { MapRef } from "react-map-gl/mapbox";
import { LngLatBounds } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Entry } from "@/lib/types";
import {
  CATEGORY_LABELS,
  MAP_PIN_COLORS,
  MAP_CATEGORY_PIN_COLORS,
  ISLAMABAD_CENTER,
  DEFAULT_ZOOM,
  MAP_MAX_ZOOM,
  MAP_2D_PITCH,
  MAP_3D_PITCH,
  MAX_MAP_PITCH,
  DEFAULT_MAP_BEARING,
  LAUNCH_CAMERA,
  CITY_CONFIG,
  DEFAULT_CITY,
  type Category,
  type CityId,
} from "@/lib/constants";
import {
  applyLegacyBasemapOptions,
  applyStandardBasemapOptions,
  DEFAULT_BASEMAP_OPTIONS,
  disableMapTerrain,
  enableMapTerrain,
  hideBlockedPlaceLabels,
  setMapFogEnabled,
  setStandardLightPreset,
  standardLightPreset,
  whenStyleReady,
  type MapBasemapOptions,
} from "@/lib/map3d";
import { animateLaunchCamera, parkLaunchCameraOpening } from "@/lib/mapLaunchCamera";
import {
  entryOrganizerName,
  formatEventSchedule,
  happeningSoonLabel,
  hasCoordinates,
  isEventHappeningSoon,
  mapPinPosition,
  truncate,
} from "@/lib/utils";
import { FloatingSprites, KohCompanion } from "@/components/KohMascot";
import { MapPopupCard } from "@/components/MapPopupCard";
import { ViewerTicker } from "@/components/ViewerTicker";
import { LiveExplorerMarkers } from "@/components/LiveExplorerMarkers";
import type { PublicChatHandle } from "@/components/PublicChat";
import { useTheme } from "@/components/ThemeProvider";
import { CategoryIcon, categoryColor } from "@/components/CategoryIcon";
import { useLivePresence } from "@/hooks/useLivePresence";
import { usePublicChat } from "@/hooks/usePublicChat";
import { useSession } from "next-auth/react";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

/** Show ambient pin name labels only when zoomed in this close */
const PIN_LABEL_MIN_ZOOM = 11.5;
/** Approx. screen separation (px) so faint labels don't pile up */
const PIN_LABEL_SEP_PX = 64;

/** Gentle accelerate-then-decelerate curve for pin-focus camera moves */
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface EntryMapProps {
  entries: Entry[];
  selectedId: string | null;
  onSelect: (entry: Entry | null) => void;
  flyToEntry?: Entry | null;
  /**
   * When this key changes with a non-empty entry list, fit the camera to those
   * pins (used by search so results are visible on the map).
   */
  fitToEntries?: Entry[] | null;
  fitToEntriesKey?: string;
  /** Active city — drives map bounds / fly-to when toggled */
  city?: CityId;
  /** When true, map clicks drop a draft pin for the suggest form */
  pinMode?: boolean;
  draftPin?: { lat: number; lng: number } | null;
  onDraftPinChange?: (lat: number, lng: number) => void;
  onCancelPinMode?: () => void;
  /** Open suggest form with a pin already dropped at these coords */
  onSuggestAt?: (lat: number, lng: number) => void;
  /** Start one-by-one pin drop after splash */
  animatePins?: boolean;
  viewedIds?: Set<string>;
  focusedCategories?: Category[];
  /** Fires once the launch fly-through settles (or immediately if it won't run) */
  onLaunchCameraDone?: () => void;
  /** Fires once the map is painted & configured — keep splash up until then */
  onMapReadyToShow?: () => void;
  /** Splash has dismissed — start the launch fly-through now */
  startLaunchCamera?: boolean;
  /** Bridge public chat UI up to the page chrome (spots stack) */
  onPublicChatChange?: (chat: PublicChatHandle | null) => void;
}

function EventPinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
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

function PlacePinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M12 21s-6.5-5.4-6.5-10.2A6.5 6.5 0 0 1 12 4.3a6.5 6.5 0 0 1 6.5 6.5C18.5 15.6 12 21 12 21Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="11" r="2.25" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function PinTooltip({ entry }: { entry: Entry }) {
  const isEvent = entry.type === "event";
  const isPending = entry.status === "pending";
  const schedule = formatEventSchedule(entry);
  const location = entry.locationText?.trim() || null;
  const soonLabel = isEvent ? happeningSoonLabel(entry) : null;
  const organizer = entryOrganizerName(entry);

  return (
    <div className="pin-tooltip pointer-events-none w-[200px] rounded-xl border border-line bg-surface px-3 py-2.5 shadow-lg">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-white ${
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
        >
          {isEvent ? (
            <EventPinIcon className="h-2.5 w-2.5" />
          ) : (
            <CategoryIcon category={entry.category} className="h-2.5 w-2.5" />
          )}
        </span>
        <span
          className={`text-[10px] font-bold uppercase tracking-wide ${
            isPending
              ? "text-[var(--pending)]"
              : isEvent
                ? "text-[var(--orange)]"
                : ""
          }`}
          style={
            !isPending && !isEvent
              ? { color: categoryColor(entry.category) }
              : undefined
          }
        >
          {CATEGORY_LABELS[entry.category]}
        </span>
        {isEvent && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            {CATEGORY_LABELS[entry.category]}
          </span>
        )}
        {isPending && <span className="pending-badge">Pending</span>}
        {soonLabel && (
          <span className="soon-badge">
            <span className="soon-badge-dot" aria-hidden />
            {soonLabel}
          </span>
        )}
      </div>
      <p className="mt-1 text-[13px] font-semibold leading-snug text-ink">
        {truncate(entry.title, 48)}
      </p>
      {organizer && (
        <p className="mt-0.5 truncate text-[11px] text-ink-muted">
          by {organizer}
        </p>
      )}
      {isEvent && (
        <p
          className={`mt-1 truncate text-[11px] font-medium ${
            isPending ? "text-[var(--pending-deep)]" : "entry-meta-event"
          }`}
        >
          {schedule ?? "Date TBA"}
        </p>
      )}
      {location &&
        !location.toLowerCase().includes("not finalised") &&
        location.toLowerCase() !== "islamabad" && (
          <p className="mt-0.5 truncate text-[11px] text-ink-muted">{location}</p>
        )}
    </div>
  );
}

const TEARDROP_PATH =
  "M16 0C7.163 0 0 7.163 0 16c0 12 16 24 16 24s16-12 16-24C32 7.163 24.837 0 16 0Z";

/** Inner hole (viewBox units) — evenodd cutout so the map shows through */
const PIN_HOLE_CX = 16;
const PIN_HOLE_CY = 14.4;
const PIN_HOLE_R = 5.5;
const TEARDROP_WITH_HOLE = `${TEARDROP_PATH} M${PIN_HOLE_CX} ${PIN_HOLE_CY} m -${PIN_HOLE_R},0 a ${PIN_HOLE_R},${PIN_HOLE_R} 0 1,0 ${PIN_HOLE_R * 2},0 a ${PIN_HOLE_R},${PIN_HOLE_R} 0 1,0 -${PIN_HOLE_R * 2},0`;

/** Google-Maps-style teardrop with a punched-out center (not a white fill) */
function TeardropPin({
  color,
  size = 16,
  soon,
  viewed,
  children,
}: {
  color: string;
  size?: number;
  soon?: boolean;
  /** Soften the pin when already opened */
  viewed?: boolean;
  children?: React.ReactNode;
}) {
  const height = Math.round(size * 1.25);
  const headSize = Math.round(size * 0.36);
  return (
    <div className="relative" style={{ width: size, height }}>
      <svg
        viewBox="0 0 32 40"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <path
          d={TEARDROP_WITH_HOLE}
          fill={color}
          fillRule="evenodd"
        />
        {viewed && (
          <circle
            cx={PIN_HOLE_CX}
            cy={PIN_HOLE_CY}
            r={PIN_HOLE_R + 1.2}
            fill="none"
            stroke="#c9cdd3"
            strokeWidth="2.2"
          />
        )}
      </svg>
      {(soon || children) && (
        <span
          className="absolute left-1/2 top-[36%] flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          style={{
            width: headSize,
            height: headSize,
            color: children ? "#ffffff" : color,
          }}
        >
          {soon && <span className="pin-soon-ring" aria-hidden />}
          {children}
        </span>
      )}
    </div>
  );
}

function MapPin({
  entry,
  isSelected,
  isViewed,
  isDimmed,
  showTooltip,
  showNameLabel,
  onHoverChange,
  enter,
  is3D,
}: {
  entry: Entry;
  isSelected: boolean;
  isViewed?: boolean;
  isDimmed?: boolean;
  showTooltip: boolean;
  /** Very faint title above the pin when zoomed in */
  showNameLabel?: boolean;
  onHoverChange: (hovering: boolean) => void;
  enter?: boolean;
  is3D?: boolean;
}) {
  const isEvent = entry.type === "event";
  const isPending = entry.status === "pending";
  const color = isPending
    ? MAP_PIN_COLORS.pending
    : isEvent
      ? MAP_PIN_COLORS.event
      : MAP_CATEGORY_PIN_COLORS[entry.category];
  const soon = isEvent && !isPending && isEventHappeningSoon(entry);
  const soonLabel = soon ? happeningSoonLabel(entry) : null;
  const showViewed = Boolean(isViewed && !isSelected && !isDimmed);
  const floatOffset = is3D ? 22 : 0;

  return (
    <div
      className={`relative ${enter ? "map-pin-enter" : ""} ${
        isDimmed && !isSelected ? "opacity-[0.45] saturate-[0.5]" : ""
      }`}
      style={{
        zIndex: isSelected ? 3 : isDimmed ? 1 : 2,
        transform: floatOffset ? `translateY(-${floatOffset}px)` : undefined,
      }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      {showTooltip && (
        <div className="absolute bottom-[calc(100%+10px)] left-1/2 z-20 -translate-x-1/2">
          <PinTooltip entry={entry} />
        </div>
      )}
      {showNameLabel && !showTooltip && !isSelected && (
        <span
          className="pin-name-label pointer-events-none absolute bottom-[calc(100%+3px)] left-1/2 z-[1] -translate-x-1/2"
          aria-hidden
        >
          {truncate(entry.title, 22)}
        </span>
      )}
      <button
        type="button"
        aria-label={`${isPending ? "Pending " : ""}${
          CATEGORY_LABELS[entry.category]
        }: ${entry.title}${soonLabel ? ` — ${soonLabel}` : ""}${
          isPending ? " — awaiting review" : ""
        }`}
        className={`relative block origin-bottom transition-transform ${
          isSelected ? "scale-125" : "hover:scale-110"
        } ${isPending ? "opacity-90" : ""}`}
      >
        <TeardropPin
          color={color}
          soon={soon}
          viewed={showViewed}
        />
      </button>
      {is3D && (
        <>
          <span
            className="absolute left-1/2 top-full w-px -translate-x-1/2"
            style={{ height: floatOffset, backgroundColor: color }}
            aria-hidden
          />
          <span
            className="absolute left-1/2 -translate-x-1/2 rounded-full"
            style={{
              top: `calc(100% + ${floatOffset - 1}px)`,
              width: 3,
              height: 3,
              backgroundColor: color,
            }}
            aria-hidden
          />
        </>
      )}
    </div>
  );
}

const LAYER_TOGGLES: {
  key: keyof MapBasemapOptions;
  label: string;
}[] = [
  { key: "placeLabels", label: "Place names" },
  { key: "roadLabels", label: "Road labels" },
  { key: "poiLabels", label: "POI labels" },
  { key: "transitLabels", label: "Transit" },
  { key: "pedestrianRoads", label: "Paths" },
  { key: "roadsAndTransit", label: "Roads" },
  { key: "buildings3d", label: "3D buildings" },
];

/** Single hamburger for 3D / tilt / layers — keeps the map chrome uncluttered */
function MapToolsMenu({
  is3D,
  onToggle3D,
  pitch,
  bearing,
  onPitchChange,
  onBearingChange,
  onResetView,
  basemapOptions,
  onBasemapChange,
  fogEnabled,
  onFogEnabledChange,
  onInteract,
}: {
  is3D: boolean;
  onToggle3D: () => void;
  pitch: number;
  bearing: number;
  onPitchChange: (value: number) => void;
  onBearingChange: (value: number) => void;
  onResetView: () => void;
  basemapOptions: MapBasemapOptions;
  onBasemapChange: (next: MapBasemapOptions) => void;
  fogEnabled: boolean;
  onFogEnabledChange: (next: boolean) => void;
  onInteract: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="map-view-controls pointer-events-auto absolute right-2 top-[calc(0.5rem+2.25rem+0.5rem)] z-20 sm:right-3">
      {!open ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onInteract();
            setOpen(true);
          }}
          aria-label="Map options"
          aria-expanded={false}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink-muted shadow-sm transition hover:bg-wash hover:text-ink"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
            <path
              d="M2.5 4h11M2.5 8h11M2.5 12h11"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : (
        <div
          className="w-[178px] rounded-2xl border border-line bg-surface p-2.5 shadow-md"
          onPointerDown={(e) => {
            e.stopPropagation();
            onInteract();
          }}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              Map
            </span>
            <button
              type="button"
              onClick={() => {
                onInteract();
                setOpen(false);
              }}
              className="text-ink-muted transition hover:text-ink"
              aria-label="Close map options"
              aria-expanded={true}
            >
              <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
                <path
                  d="M2 2l8 8M10 2l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              onInteract();
              onToggle3D();
            }}
            aria-pressed={is3D}
            className="mb-2 flex w-full items-center justify-between rounded-xl border border-line bg-wash px-2.5 py-2 text-left text-[11px] font-semibold text-ink transition hover:bg-surface"
          >
            <span>{is3D ? "3D map" : "2D map"}</span>
            <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-muted">
              {is3D ? "3D" : "2D"}
            </span>
          </button>

          {is3D && (
            <div className="mb-2 rounded-xl border border-line bg-wash/60 p-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  View
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onInteract();
                    onResetView();
                  }}
                  className="text-[10px] font-medium text-ink-muted transition hover:text-ink"
                  aria-label="Reset tilt and heading"
                >
                  Reset
                </button>
              </div>
              <label className="mb-2 block">
                <div className="mb-0.5 flex items-center justify-between text-[10px] text-ink-muted">
                  <span>Tilt</span>
                  <span className="tabular-nums">{pitch}°</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={MAX_MAP_PITCH}
                  step={1}
                  value={pitch}
                  onChange={(e) => onPitchChange(Number(e.target.value))}
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                  className="map-view-slider w-full"
                  aria-label="Map tilt"
                />
              </label>
              <label className="block">
                <div className="mb-0.5 flex items-center justify-between text-[10px] text-ink-muted">
                  <span>Heading</span>
                  <span className="tabular-nums">{bearing}°</span>
                </div>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={bearing}
                  onChange={(e) => onBearingChange(Number(e.target.value))}
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                  className="map-view-slider w-full"
                  aria-label="Map heading"
                />
              </label>
            </div>
          )}

          <div>
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              Layers
            </span>
            <div className="flex flex-col gap-1">
              <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-ink">
                <span className="text-ink-muted">Atmosphere / fog</span>
                <input
                  type="checkbox"
                  checked={fogEnabled}
                  onChange={(e) => {
                    onInteract();
                    onFogEnabledChange(e.target.checked);
                  }}
                  className="h-3.5 w-3.5 accent-[var(--blue)]"
                />
              </label>
              {LAYER_TOGGLES.map(({ key, label }) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-ink"
                >
                  <span className="text-ink-muted">{label}</span>
                  <input
                    type="checkbox"
                    checked={basemapOptions[key]}
                    onChange={(e) => {
                      onInteract();
                      onBasemapChange({
                        ...basemapOptions,
                        [key]: e.target.checked,
                      });
                    }}
                    className="h-3.5 w-3.5 accent-[var(--blue)]"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function EntryMap({
  entries,
  selectedId,
  onSelect,
  flyToEntry,
  fitToEntries = null,
  fitToEntriesKey = "",
  city = DEFAULT_CITY,
  pinMode = false,
  draftPin = null,
  onDraftPinChange,
  onCancelPinMode,
  onSuggestAt,
  animatePins = false,
  viewedIds,
  focusedCategories = [],
  onLaunchCameraDone,
  onMapReadyToShow,
  startLaunchCamera = false,
  onPublicChatChange,
}: EntryMapProps) {
  const mapRef = useRef<MapRef>(null);
  const mapPaneRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const [isMobile, setIsMobile] = useState(false);
  const [mapVisible, setMapVisible] = useState(false);
  const [launchPrepared, setLaunchPrepared] = useState(false);
  const mapReadyToShowFired = useRef(false);
  const [popupEntry, setPopupEntry] = useState<Entry | null>(null);
  const [panelPos, setPanelPos] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [suggestPrompt, setSuggestPrompt] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const { data: session, status: authStatus } = useSession();
  const signedIn = authStatus === "authenticated" && Boolean(session?.user);
  const {
    selfId,
    displayName,
    selfColor,
    selfPosition,
    viewers,
    explorers: liveExplorers,
    showExplorers,
    setShowExplorers,
  } = useLivePresence(mapRef, mapReady);
  const {
    messages: chatMessages,
    floating: floatingChats,
    sending: chatSending,
    sendError: chatSendError,
    sendMessage,
    needsLoginToSend,
  } = usePublicChat({
    mapRef,
    selfId,
    displayName,
    selfColor,
    enabled: mapReady,
    signedIn,
  });

  useEffect(() => {
    if (!onPublicChatChange) return;
    onPublicChatChange({
      messages: chatMessages,
      selfId,
      displayName,
      sending: chatSending,
      sendError: chatSendError,
      onSend: sendMessage,
      needsLoginToSend,
      signedIn,
    });
    return () => onPublicChatChange(null);
  }, [
    onPublicChatChange,
    chatMessages,
    selfId,
    displayName,
    chatSending,
    chatSendError,
    sendMessage,
    needsLoginToSend,
    signedIn,
  ]);

  const [visiblePinCount, setVisiblePinCount] = useState(0);
  const [enteringPinIds, setEnteringPinIds] = useState<Set<string>>(
    () => new Set()
  );
  // Pins lower on screen sit closer to the camera in a tilted 3D view — this
  // ranks every pin by projected screen Y so nearer pins draw above farther
  // ones instead of stacking in arbitrary DOM order.
  const [pinDepthOrder, setPinDepthOrder] = useState<Map<string, number>>(
    () => new globalThis.Map()
  );
  /** Pin ids that get a faint ambient name label at the current camera */
  const [labeledPinIds, setLabeledPinIds] = useState<Set<string>>(
    () => new Set()
  );
  const revealGen = useRef(0);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const [is3D, setIs3D] = useState(() => {
    if (typeof window === "undefined") return true;
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  const [pitch, setPitch] = useState(MAP_3D_PITCH);
  const [bearing, setBearing] = useState(DEFAULT_MAP_BEARING);
  const [basemapOptions, setBasemapOptions] = useState<MapBasemapOptions>(
    DEFAULT_BASEMAP_OPTIONS
  );
  const [fogEnabled, setFogEnabled] = useState(true);
  const saved3DView = useRef({ pitch: MAP_3D_PITCH, bearing: DEFAULT_MAP_BEARING });
  const suppressMapClick = useRef(false);
  const launchCameraPlayed = useRef(false);
  const launchCameraActive = useRef(
    typeof window === "undefined"
      ? false
      : !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const launchCameraDoneFired = useRef(false);
  const onMapReadyToShowRef = useRef(onMapReadyToShow);
  onMapReadyToShowRef.current = onMapReadyToShow;
  const onLaunchCameraDoneRef = useRef(onLaunchCameraDone);
  onLaunchCameraDoneRef.current = onLaunchCameraDone;

  const fireLaunchCameraDone = useCallback(() => {
    if (launchCameraDoneFired.current) return;
    launchCameraDoneFired.current = true;
    onLaunchCameraDoneRef.current?.();
  }, []);

  const revealMap = useCallback(() => {
    setMapVisible(true);
    if (mapReadyToShowFired.current) return;
    mapReadyToShowFired.current = true;
    onMapReadyToShowRef.current?.();
  }, []);

  const mappableEntries = entries.filter(hasCoordinates);
  const mappableIdsKey = mappableEntries.map((e) => e.id).join("|");
  const mappableRef = useRef(mappableEntries);
  mappableRef.current = mappableEntries;

  // Keep Mapbox in sync when the map pane size changes (sheet open/close,
  // expand/collapse, etc). Debounce during motion so the canvas doesn't flash.
  useEffect(() => {
    if (!mapReady) return;
    const pane = mapPaneRef.current ?? shellRef.current;
    const map = mapRef.current?.getMap();
    if (!pane || !map) return;

    let settleTimer = 0;
    const resize = () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => map.resize(), 140);
    };
    map.resize();
    const ro = new ResizeObserver(resize);
    ro.observe(pane);
    return () => {
      window.clearTimeout(settleTimer);
      ro.disconnect();
    };
  }, [mapReady]);

  // Rank pins by projected screen Y so pins nearer the camera (lower on
  // screen in a tilted view) draw above pins farther away, instead of
  // stacking in arbitrary DOM order. Also pick a sparse set of nearby
  // pins that can show a dim name label without crowding.
  // Recomputed on every camera move — pan, zoom, rotate, and pitch.
  const recomputePinDepthOrder = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const list = mappableRef.current;
    if (list.length === 0) {
      setPinDepthOrder((prev) => (prev.size === 0 ? prev : new globalThis.Map()));
      setLabeledPinIds((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }

    const projected = list.map((entry) => {
      const pos = mapPinPosition(entry, list);
      const pt = map.project([pos.lng, pos.lat]);
      return { id: entry.id, x: pt.x, y: pt.y };
    });

    const ranked = [...projected].sort((a, b) => a.y - b.y);
    setPinDepthOrder(
      new globalThis.Map(ranked.map((item, index) => [item.id, index]))
    );

    const zoom = map.getZoom();
    if (zoom < PIN_LABEL_MIN_ZOOM) {
      setLabeledPinIds((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }

    // Tighter spacing as you zoom further in — more labels can fit.
    // Farther out, keep more gap so names stay readable.
    const sep =
      zoom >= 15 ? 44 : zoom >= 14 ? 52 : zoom >= 13 ? 60 : PIN_LABEL_SEP_PX;
    const sepSq = sep * sep;

    // Prefer nearer-to-camera pins (higher screen Y) for labels.
    const byNear = [...projected].sort((a, b) => b.y - a.y);
    const placed: Array<{ x: number; y: number }> = [];
    const nextLabels = new Set<string>();

    for (const pin of byNear) {
      // Skip off-screen-ish pins (small pad)
      if (
        pin.x < -40 ||
        pin.y < -40 ||
        pin.x > map.getContainer().clientWidth + 40 ||
        pin.y > map.getContainer().clientHeight + 40
      ) {
        continue;
      }
      let clashes = false;
      for (const other of placed) {
        const dx = pin.x - other.x;
        const dy = pin.y - other.y;
        if (dx * dx + dy * dy < sepSq) {
          clashes = true;
          break;
        }
      }
      if (clashes) continue;
      placed.push({ x: pin.x, y: pin.y });
      nextLabels.add(pin.id);
    }

    setLabeledPinIds((prev) => {
      if (prev.size === nextLabels.size) {
        let same = true;
        for (const id of Array.from(nextLabels)) {
          if (!prev.has(id)) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return nextLabels;
    });
  }, []);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapReady) return;

    recomputePinDepthOrder();

    let raf = 0;
    const schedule = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(recomputePinDepthOrder);
    };
    map.on("move", schedule);
    map.on("resize", schedule);
    return () => {
      window.cancelAnimationFrame(raf);
      map.off("move", schedule);
      map.off("resize", schedule);
    };
  }, [mapReady, mappableIdsKey, recomputePinDepthOrder]);

  // Prepare under splash (terrain / fog / opening pose). Flight starts separately
  // once the splash dismisses (`startLaunchCamera`) so the user actually sees it.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapReady || pinMode) return;

    const prepareUnderSplash = () => {
      if (is3D) {
        enableMapTerrain(map);
        setStandardLightPreset(map, theme);
        applyStandardBasemapOptions(map, basemapOptions);
      } else if (theme === "dusk") {
        setStandardLightPreset(map, "dusk");
        applyStandardBasemapOptions(map, basemapOptions);
      } else {
        applyLegacyBasemapOptions(map, basemapOptions);
      }
      setMapFogEnabled(map, fogEnabled, theme);
    };

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const skipFlight = !is3D || reduceMotion;

    if (skipFlight) {
      if (reduceMotion) launchCameraActive.current = false;
      const cancelReady = whenStyleReady(map, () => {
        prepareUnderSplash();
        const reveal = () => revealMap();
        map.once("idle", reveal);
        window.setTimeout(reveal, 500);
        fireLaunchCameraDone();
      });
      return cancelReady;
    }

    let settleTimer = 0;
    let onIdle: (() => void) | null = null;

    const cancelReady = whenStyleReady(map, () => {
      map.stop();
      prepareUnderSplash();
      parkLaunchCameraOpening(map);
      launchCameraActive.current = true;
      setLaunchPrepared(true);

      const show = () => {
        window.clearTimeout(settleTimer);
        if (onIdle) map.off("idle", onIdle);
        onIdle = null;
        revealMap();
      };

      onIdle = show;
      map.once("idle", show);
      settleTimer = window.setTimeout(show, 600);
    });

    return () => {
      cancelReady();
      window.clearTimeout(settleTimer);
      if (onIdle) map.off("idle", onIdle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prepare once at mapReady
  }, [mapReady, is3D, pinMode, fireLaunchCameraDone, revealMap]);

  // Start the fly-through only after the splash has dismissed
  useEffect(() => {
    if (!startLaunchCamera || !mapReady || !launchPrepared || !is3D || pinMode) {
      return;
    }
    if (launchCameraPlayed.current) return;

    const map = mapRef.current?.getMap();
    if (!map) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (reduceMotion) {
      launchCameraActive.current = false;
      fireLaunchCameraDone();
      return;
    }

    launchCameraPlayed.current = true;
    launchCameraActive.current = true;

    let startTimer = 0;
    let cancelAnimation: (() => void) | null = null;

    // Brief beat after splash fade so the opening frame paints, then fly.
    startTimer = window.setTimeout(() => {
      cancelAnimation = animateLaunchCamera(
        map,
        LAUNCH_CAMERA.durationMs,
        () => {
          saved3DView.current = {
            pitch: LAUNCH_CAMERA.pitch,
            bearing: LAUNCH_CAMERA.bearing,
          };
          setPitch(LAUNCH_CAMERA.pitch);
          setBearing(LAUNCH_CAMERA.bearing);
          launchCameraActive.current = false;
          fireLaunchCameraDone();
        }
      );
    }, 120);

    return () => {
      window.clearTimeout(startTimer);
      cancelAnimation?.();
      // Strict Mode remounts / cancelled runs should be allowed to retry
      launchCameraPlayed.current = false;
    };
  }, [
    startLaunchCamera,
    launchPrepared,
    mapReady,
    is3D,
    pinMode,
    fireLaunchCameraDone,
  ]);

  // Terrain + pitch when toggling 2D / 3D
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapReady || launchCameraActive.current) return;

    const cancelReady = whenStyleReady(map, () => {
      // Launch fly-through may have started while we waited for style-ready.
      if (launchCameraActive.current) return;
      if (is3D) {
        enableMapTerrain(map);
        const { pitch: p, bearing: b } = saved3DView.current;
        setPitch(p);
        setBearing(b);
        map.easeTo({ pitch: p, bearing: b, duration: 700 });
      } else {
        saved3DView.current = {
          pitch: map.getPitch(),
          bearing: map.getBearing(),
        };
        disableMapTerrain(map);
        setPitch(MAP_2D_PITCH);
        map.easeTo({ pitch: MAP_2D_PITCH, duration: 700 });
      }
    });

    return cancelReady;
  }, [is3D, mapReady]);

  // Keep sliders in sync after drag-to-rotate / pitch gestures
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapReady || !is3D) return;

    const sync = () => {
      const p = Math.round(map.getPitch());
      const b = Math.round(map.getBearing());
      setPitch(p);
      setBearing(b);
      saved3DView.current = { pitch: p, bearing: b };
    };

    map.on("moveend", sync);
    return () => {
      map.off("moveend", sync);
    };
  }, [mapReady, is3D]);

  // After pitch / rotate / pan / zoom (esp. two-finger gestures), the browser
  // often synthesizes a click under a finger — which would open a pin detail.
  // Suppress pin + map clicks for a short window after those gestures.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapReady) return;

    let releaseTimer = 0;
    const arm = () => {
      window.clearTimeout(releaseTimer);
      suppressMapClick.current = true;
    };
    const release = () => {
      window.clearTimeout(releaseTimer);
      // Long enough to eat the synthetic click after finger-up
      releaseTimer = window.setTimeout(() => {
        suppressMapClick.current = false;
      }, 400);
    };

    const gestureStarts = [
      "dragstart",
      "zoomstart",
      "rotatestart",
      "pitchstart",
    ] as const;
    const gestureEnds = [
      "dragend",
      "zoomend",
      "rotateend",
      "pitchend",
    ] as const;

    for (const ev of gestureStarts) map.on(ev, arm);
    for (const ev of gestureEnds) map.on(ev, release);

    const canvas = map.getCanvas();
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) arm();
    };
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });

    return () => {
      window.clearTimeout(releaseTimer);
      for (const ev of gestureStarts) map.off(ev, arm);
      for (const ev of gestureEnds) map.off(ev, release);
      canvas.removeEventListener("touchstart", onTouchStart);
    };
  }, [mapReady]);

  const blockMapClick = useCallback(() => {
    suppressMapClick.current = true;
    window.setTimeout(() => {
      suppressMapClick.current = false;
    }, 250);
  }, []);

  const handlePitchChange = useCallback((value: number) => {
    blockMapClick();
    setPitch(value);
    saved3DView.current.pitch = value;
    mapRef.current?.easeTo({ pitch: value, duration: 250 });
  }, [blockMapClick]);

  const handleBearingChange = useCallback((value: number) => {
    blockMapClick();
    setBearing(value);
    saved3DView.current.bearing = value;
    mapRef.current?.easeTo({ bearing: value, duration: 250 });
  }, [blockMapClick]);

  const resetMapView = useCallback(() => {
    const next = { pitch: MAP_3D_PITCH, bearing: DEFAULT_MAP_BEARING };
    saved3DView.current = next;
    setPitch(next.pitch);
    setBearing(next.bearing);
    mapRef.current?.easeTo({ pitch: next.pitch, bearing: next.bearing, duration: 400 });
  }, []);

  // Re-apply 3D setup + layer toggles after style changes (theme / 2D↔3D)
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapReady) return;

    const apply = () => {
      if (is3D) {
        enableMapTerrain(map);
        setStandardLightPreset(map, theme);
        applyStandardBasemapOptions(map, basemapOptions);
      } else if (theme === "dusk") {
        setStandardLightPreset(map, "dusk");
        applyStandardBasemapOptions(map, basemapOptions);
      } else {
        applyLegacyBasemapOptions(map, basemapOptions);
      }
      setMapFogEnabled(map, fogEnabled, theme);
    };

    let cancelNested: (() => void) | null = null;
    const onStyleLoad = () => {
      cancelNested?.();
      cancelNested = whenStyleReady(map, apply);
    };

    map.on("style.load", onStyleLoad);
    const cancelReady = whenStyleReady(map, apply);
    return () => {
      map.off("style.load", onStyleLoad);
      cancelReady();
      cancelNested?.();
    };
  }, [mapReady, is3D, theme, basemapOptions, fogEnabled]);

  // Fog toggle (also re-applied after style / theme changes above)
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapReady) return;
    const cancelReady = whenStyleReady(map, () => {
      setMapFogEnabled(map, fogEnabled, theme);
    });
    return cancelReady;
  }, [mapReady, fogEnabled, theme]);

  // Hide denylisted place names (e.g. CHOUR HARPAL) when place labels are on
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapReady || !is3D || !basemapOptions.placeLabels) return;

    let scheduled = 0;
    const apply = () => {
      window.cancelAnimationFrame(scheduled);
      scheduled = window.requestAnimationFrame(() => {
        hideBlockedPlaceLabels(map);
      });
    };

    map.on("idle", apply);
    map.on("moveend", apply);
    apply();
    return () => {
      window.cancelAnimationFrame(scheduled);
      map.off("idle", apply);
      map.off("moveend", apply);
    };
  }, [mapReady, is3D, basemapOptions.placeLabels]);

  // Drop every pin in one-by-one whenever the visible set changes
  // (page load, All / Events / Places, category filters, etc.)
  useEffect(() => {
    if (!mapReady || !animatePins || pinMode) return;

    if (mappableEntries.length === 0) {
      setVisiblePinCount(0);
      setEnteringPinIds(new Set());
      return;
    }

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      setVisiblePinCount(mappableEntries.length);
      setEnteringPinIds(new Set());
      return;
    }

    const pins = mappableEntries;
    const gen = ++revealGen.current;
    setVisiblePinCount(0);
    setEnteringPinIds(new Set());

    let i = 0;
    const stepMs = Math.max(
      28,
      Math.min(55, 900 / Math.max(pins.length, 1))
    );
    const clearEnterTimers: number[] = [];
    let timer = 0;

    const tick = () => {
      if (gen !== revealGen.current) return;
      i += 1;
      const next = pins[i - 1];
      if (next) {
        setEnteringPinIds((prev) => new Set(prev).add(next.id));
        clearEnterTimers.push(
          window.setTimeout(() => {
            if (gen !== revealGen.current) return;
            setEnteringPinIds((prev) => {
              const copy = new Set(prev);
              copy.delete(next.id);
              return copy;
            });
          }, 420)
        );
      }
      setVisiblePinCount(i);
      if (i >= pins.length) return;
      timer = window.setTimeout(tick, stepMs);
    };

    timer = window.setTimeout(tick, 60);
    return () => {
      revealGen.current += 1; // invalidate in-flight reveal
      window.clearTimeout(timer);
      clearEnterTimers.forEach((id) => window.clearTimeout(id));
    };
    // mappableIdsKey tracks the full pin set identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, animatePins, pinMode, mappableIdsKey]);

  useEffect(() => {
    if (pinMode) {
      setPopupEntry(null);
      setHoveredId(null);
      setSuggestPrompt(null);
    }
  }, [pinMode]);

  useEffect(() => {
    if (!onSuggestAt) setSuggestPrompt(null);
  }, [onSuggestAt]);

  const focusPinNearCard = useCallback(
    (entry: Entry) => {
      if (!hasCoordinates(entry) || pinMode) return;
      const map = mapRef.current?.getMap();
      const w = map?.getContainer().clientWidth ?? 600;
      const mobile = window.matchMedia("(max-width: 1023px)").matches;
      // Read live camera from the map — don't close over pitch/bearing state
      // or every two-finger tilt recreates this callback and re-opens the card.
      const livePitch =
        map?.getPitch() ?? (is3D ? MAP_3D_PITCH : MAP_2D_PITCH);
      const liveBearing =
        map?.getBearing() ?? (is3D ? DEFAULT_MAP_BEARING : 0);

      if (mobile) {
        // Map pane is already squeezed by the sheet — center the pin in it
        mapRef.current?.flyTo({
          center: [entry.lng!, entry.lat!],
          zoom: Math.max(mapRef.current.getZoom() ?? DEFAULT_ZOOM, 13.5),
          pitch: is3D ? livePitch : MAP_2D_PITCH,
          bearing: is3D ? liveBearing : 0,
          duration: 900,
          easing: easeInOutCubic,
          padding: { top: 56, bottom: 40, left: 28, right: 28 },
          essential: true,
        });
        return;
      }

      // Desktop: leave a pocket to the right of the pin for the detail card
      const rightPad = Math.round(Math.min(Math.max(w * 0.28, 180), 300));
      mapRef.current?.flyTo({
        center: [entry.lng!, entry.lat!],
        zoom: Math.max(mapRef.current.getZoom() ?? DEFAULT_ZOOM, 13.5),
        pitch: is3D ? livePitch : MAP_2D_PITCH,
        bearing: is3D ? liveBearing : 0,
        duration: 1300,
        easing: easeInOutCubic,
        padding: { top: 56, bottom: 56, left: 48, right: rightPad },
        essential: true,
      });
    },
    [pinMode, is3D]
  );

  const focusPinNearCardRef = useRef(focusPinNearCard);
  focusPinNearCardRef.current = focusPinNearCard;

  const updatePanelPos = useCallback(() => {
    if (!popupEntry || !hasCoordinates(popupEntry)) {
      setPanelPos(null);
      return;
    }
    const map = mapRef.current?.getMap();
    const shell = shellRef.current;
    if (!map || !shell) return;

    const shellW = shell.clientWidth;
    const shellH = shell.clientHeight;
    const margin = 12;
    const mobile = window.matchMedia("(max-width: 1023px)").matches;

    if (mobile) {
      // Mobile uses a layout sheet (not absolute coords)
      setPanelPos(null);
      return;
    }

    const pin = mapPinPosition(popupEntry, mappableRef.current);
    const pt = map.project([pin.lng, pin.lat]);
    const width = Math.min(340, Math.max(260, shellW - 24));
    const gap = 28;

    // Prefer just to the right of the pin; flip left if it would clip
    let left = pt.x + gap;
    if (left + width > shellW - margin) {
      left = pt.x - gap - width;
    }
    left = Math.max(margin, Math.min(left, shellW - width - margin));

    const maxHeight = Math.min(460, Math.round(shellH * 0.85));
    const cardH = Math.min(
      panelRef.current?.offsetHeight || 360,
      maxHeight
    );
    let top = pt.y - cardH / 2;
    top = Math.max(margin, Math.min(top, shellH - cardH - margin));

    const next = {
      left: Math.round(left),
      top: Math.round(top),
      width,
      maxHeight,
    };
    setPanelPos((prev) =>
      prev &&
      prev.left === next.left &&
      prev.top === next.top &&
      prev.width === next.width &&
      prev.maxHeight === next.maxHeight
        ? prev
        : next
    );
  }, [popupEntry]);

  useEffect(() => {
    if (!popupEntry || !mapReady || pinMode) {
      setPanelPos(null);
      return;
    }
    if (isMobile) {
      setPanelPos(null);
      return;
    }
    updatePanelPos();
    const raf = window.requestAnimationFrame(() => updatePanelPos());
    const map = mapRef.current?.getMap();
    if (!map) {
      return () => window.cancelAnimationFrame(raf);
    }
    map.on("move", updatePanelPos);
    map.on("zoom", updatePanelPos);
    map.on("resize", updatePanelPos);
    return () => {
      window.cancelAnimationFrame(raf);
      map.off("move", updatePanelPos);
      map.off("zoom", updatePanelPos);
      map.off("resize", updatePanelPos);
    };
  }, [popupEntry, mapReady, pinMode, isMobile, updatePanelPos]);

  // After the mobile sheet mounts, resize the map into the remaining pane
  // and keep the selected pin centered in that upper area.
  useEffect(() => {
    if (!isMobile || !popupEntry || pinMode || !mapReady) return;
    if (!hasCoordinates(popupEntry)) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      map.resize();
      map.easeTo({
        center: [popupEntry.lng!, popupEntry.lat!],
        zoom: Math.max(map.getZoom(), 13.5),
        padding: { top: 56, bottom: 40, left: 28, right: 28 },
        duration: 420,
        essential: true,
      });
    };
    const raf = window.requestAnimationFrame(() => {
      window.setTimeout(run, 40);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
    // Intentionally keyed by id — full popupEntry would re-run on unrelated field edits
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, popupEntry?.id, pinMode, mapReady]);

  useEffect(() => {
    if (flyToEntry && hasCoordinates(flyToEntry) && !pinMode) {
      setPopupEntry(flyToEntry);
      setHoveredId(null);
      focusPinNearCardRef.current(flyToEntry);
    }
    // Only when the fly-to target changes — not when focusPinNearCard identity
    // changes (that used to re-open the last card on every pitch/rotate).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToEntry, pinMode]);

  // Search (and similar) — frame matching pins on the map
  useEffect(() => {
    if (!mapReady || pinMode || !fitToEntriesKey) return;
    const targets = (fitToEntries ?? []).filter(hasCoordinates);
    if (targets.length === 0) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    if (targets.length === 1) {
      const only = targets[0]!;
      setPopupEntry(only);
      setHoveredId(null);
      onSelect(only);
      focusPinNearCardRef.current(only);
      return;
    }

    const bounds = new LngLatBounds();
    for (const entry of targets) {
      bounds.extend([entry.lng!, entry.lat!]);
    }
    if (bounds.isEmpty()) return;

    setPopupEntry(null);
    map.fitBounds(bounds, {
      padding: isMobile
        ? { top: 72, bottom: 160, left: 36, right: 36 }
        : { top: 88, bottom: 140, left: 72, right: 72 },
      maxZoom: 14.5,
      duration: 900,
      essential: true,
    });
  }, [fitToEntriesKey, fitToEntries, mapReady, pinMode, isMobile]);

  useEffect(() => {
    if (draftPin && pinMode) {
      mapRef.current?.flyTo({
        center: [draftPin.lng, draftPin.lat],
        zoom: Math.max(mapRef.current.getZoom(), 13),
        pitch: is3D ? pitch : MAP_2D_PITCH,
        bearing: is3D ? bearing : 0,
        duration: 500,
      });
    }
  }, [draftPin, pinMode, is3D, pitch, bearing]);

  // City toggle — update pan limits and fly to the new city center
  const cityRef = useRef(city);
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    const config = CITY_CONFIG[city];
    map.setMaxBounds(config.maxBounds);
    map.setMinZoom(config.minZoom);

    const changed = cityRef.current !== city;
    cityRef.current = city;
    if (!changed || launchCameraActive.current) return;

    setPopupEntry(null);
    setHoveredId(null);
    setSuggestPrompt(null);

    mapRef.current?.flyTo({
      center: [config.center.lng, config.center.lat],
      zoom: config.defaultZoom,
      pitch: is3D ? pitch : MAP_2D_PITCH,
      bearing:
        is3D && city === "islamabad" ? DEFAULT_MAP_BEARING : is3D ? bearing : 0,
      duration: 1400,
      essential: true,
    });
  }, [city, mapReady, is3D, pitch, bearing]);

  const handleMarkerClick = useCallback(
    (entry: Entry) => {
      if (pinMode) return;
      if (suppressMapClick.current || launchCameraActive.current) return;
      setSuggestPrompt(null);
      onSelect(entry);
      setPopupEntry(entry);
      setHoveredId(null);
      focusPinNearCard(entry);
    },
    [onSelect, pinMode, focusPinNearCard]
  );

  const browseIndex = popupEntry
    ? mappableEntries.findIndex((e) => e.id === popupEntry.id)
    : -1;

  const browseTo = useCallback(
    (delta: number) => {
      if (pinMode || browseIndex < 0 || mappableEntries.length < 2) return;
      const nextIndex =
        (browseIndex + delta + mappableEntries.length) % mappableEntries.length;
      const next = mappableEntries[nextIndex];
      if (!next) return;
      setSuggestPrompt(null);
      setPopupEntry(next);
      onSelect(next);
      setHoveredId(null);
      focusPinNearCard(next);
    },
    [
      pinMode,
      browseIndex,
      mappableEntries,
      onSelect,
      focusPinNearCard,
    ]
  );

  const dismissSuggestPrompt = useCallback(() => {
    setSuggestPrompt(null);
  }, []);

  const confirmSuggestPrompt = useCallback(() => {
    if (!suggestPrompt || !onSuggestAt) return;
    const { lat, lng } = suggestPrompt;
    setSuggestPrompt(null);
    onSuggestAt(lat, lng);
  }, [suggestPrompt, onSuggestAt]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-full items-center justify-center bg-wash p-6 text-center">
        <p className="text-sm text-ink-muted">
          Map unavailable — set{" "}
          <code className="text-xs">NEXT_PUBLIC_MAPBOX_TOKEN</code> in your
          environment.
        </p>
      </div>
    );
  }

  const showMobileSheet = isMobile && !pinMode && Boolean(popupEntry);
  const showDesktopPanel =
    !isMobile && !pinMode && Boolean(popupEntry) && Boolean(panelPos);

  return (
    <div ref={shellRef} className="relative z-0 flex h-full w-full flex-col">
      <div
        ref={mapPaneRef}
        className={`relative min-h-0 flex-1 transition-opacity duration-300 ease-out ${
          mapVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        <Map
          ref={mapRef}
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={{
            latitude: is3D ? LAUNCH_CAMERA.start.lat : ISLAMABAD_CENTER.lat,
            longitude: is3D ? LAUNCH_CAMERA.start.lng : ISLAMABAD_CENTER.lng,
            zoom: is3D ? LAUNCH_CAMERA.start.zoom : DEFAULT_ZOOM,
            pitch: is3D ? LAUNCH_CAMERA.pitch : MAP_2D_PITCH,
            bearing: is3D ? LAUNCH_CAMERA.bearing : 0,
          }}
          style={{ width: "100%", height: "100%", zIndex: 0 }}
          attributionControl={false}
          logoPosition="bottom-right"
          maxBounds={CITY_CONFIG[city].maxBounds}
          minZoom={CITY_CONFIG[city].minZoom}
          maxZoom={MAP_MAX_ZOOM}
          mapStyle={
            is3D || theme === "dusk"
              ? "mapbox://styles/mapbox/standard"
              : theme === "dark"
                ? "mapbox://styles/mapbox/dark-v11"
                : "mapbox://styles/mapbox/streets-v12"
          }
          // Bake time-of-day into Standard on create — avoids day→dusk flash.
          {...((is3D || theme === "dusk")
            ? {
                config: {
                  basemap: {
                    lightPreset: standardLightPreset(theme),
                  },
                },
              }
            : {})}
          dragRotate={is3D}
          touchPitch={is3D}
          maxPitch={MAX_MAP_PITCH}
          cursor={pinMode ? "crosshair" : undefined}
          onLoad={() => {
            // Don't mutate Standard style here — imports may still be loading.
            // Terrain / layer config run in the style-ready effect.
            setMapReady(true);
          }}
          onClick={(e) => {
            if (pinMode && onDraftPinChange) {
              onDraftPinChange(e.lngLat.lat, e.lngLat.lng);
              return;
            }
            if (suppressMapClick.current || launchCameraActive.current) return;
            // Ignore clicks on UI controls / markers (markers stopPropagation)
            const target = e.originalEvent.target as HTMLElement | null;
            if (
              target?.closest?.(
                ".mapboxgl-ctrl, .mapboxgl-popup, .map-view-controls, .map-3d-toggle, button, a, input, label"
              )
            ) {
              return;
            }
            setPopupEntry(null);
            setHoveredId(null);
            onSelect(null);
            if (onSuggestAt) {
              // Toggle: second map click dismisses instead of moving/spawning
              setSuggestPrompt((prev) =>
                prev
                  ? null
                  : { lat: e.lngLat.lat, lng: e.lngLat.lng }
              );
            }
          }}
        >
          <AttributionControl compact position="bottom-right" />

          {showExplorers && !pinMode && (
            <LiveExplorerMarkers
              explorers={liveExplorers}
              floating={floatingChats}
              selfId={selfId}
              selfPosition={selfPosition}
            />
          )}
          {!showExplorers && !pinMode && floatingChats.length > 0 && (
            <LiveExplorerMarkers
              explorers={[]}
              floating={floatingChats}
              selfId={selfId}
              selfPosition={selfPosition}
            />
          )}

          {mappableEntries
            .slice(0, pinMode ? mappableEntries.length : visiblePinCount)
            .map((entry) => {
            const isSelected = !pinMode && selectedId === entry.id;
            const showTooltip =
              !pinMode &&
              hoveredId === entry.id &&
              popupEntry?.id !== entry.id;
            const position = mapPinPosition(entry, mappableEntries);
            const enter = !pinMode && enteringPinIds.has(entry.id);
            const depthRank = pinDepthOrder.get(entry.id) ?? 0;

            return (
              <Marker
                key={entry.id}
                latitude={position.lat}
                longitude={position.lng}
                anchor="bottom"
                style={{
                  // Nearer-to-camera pins (ranked by recomputePinDepthOrder)
                  // draw above farther ones; selected/hovered/entering pins
                  // always win regardless of depth.
                  zIndex:
                    showTooltip || isSelected || enter
                      ? 20 + depthRank
                      : 1 + depthRank,
                  opacity: pinMode ? 0.22 : 1,
                  // Explicitly clear filter — `undefined` can leave Mapbox markers dulled
                  filter: pinMode
                    ? "grayscale(0.85) saturate(0.2)"
                    : "none",
                  pointerEvents: pinMode ? "none" : "auto",
                }}
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  handleMarkerClick(entry);
                }}
              >
                <div
                  className={pinMode ? "pin-dulled" : undefined}
                  style={
                    pinMode
                      ? undefined
                      : { opacity: 1, filter: "none" }
                  }
                >
                  <MapPin
                    entry={entry}
                    isSelected={isSelected}
                    isViewed={viewedIds?.has(entry.id)}
                    isDimmed={
                      focusedCategories.length > 0 &&
                      !focusedCategories.includes(entry.category)
                    }
                    showTooltip={showTooltip}
                    showNameLabel={
                      !pinMode && labeledPinIds.has(entry.id)
                    }
                    enter={enter}
                    is3D={is3D && !pinMode}
                    onHoverChange={(hovering) =>
                      setHoveredId(hovering ? entry.id : null)
                    }
                  />
                </div>
              </Marker>
            );
          })}

          {pinMode && draftPin && (
            <Marker
              latitude={draftPin.lat}
              longitude={draftPin.lng}
              anchor="bottom"
              style={{ zIndex: 30 }}
            >
              <div className="relative flex flex-col items-center">
                <span className="mb-1 rounded-full bg-[var(--blue)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
                  Your pin
                </span>
                <TeardropPin color={MAP_PIN_COLORS.place}>
                  <PlacePinIcon className="h-3.5 w-3.5" />
                </TeardropPin>
              </div>
            </Marker>
          )}

          {!pinMode && suggestPrompt && onSuggestAt && (
            <>
              <Marker
                latitude={suggestPrompt.lat}
                longitude={suggestPrompt.lng}
                anchor="bottom"
                style={{ zIndex: 25 }}
              >
                <div className="relative flex flex-col items-center">
                  <TeardropPin color={MAP_PIN_COLORS.place} size={20}>
                    <PlacePinIcon className="h-2.5 w-2.5" />
                  </TeardropPin>
                </div>
              </Marker>
              <Popup
                latitude={suggestPrompt.lat}
                longitude={suggestPrompt.lng}
                anchor="bottom"
                onClose={dismissSuggestPrompt}
                closeOnClick={false}
                closeButton={false}
                maxWidth="280px"
                offset={36}
                className="entry-map-popup"
              >
                <div
                  className="w-[240px] rounded-xl border border-line bg-surface p-3 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-sm font-semibold leading-snug text-ink">
                    Would you like to add a spot here?
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={confirmSuggestPrompt}
                      className="btn-primary flex-1 rounded-full border px-3 py-2 text-xs font-semibold"
                    >
                      Yes, create
                    </button>
                    <button
                      type="button"
                      onClick={dismissSuggestPrompt}
                      className="rounded-full border border-line-strong bg-surface px-3 py-2 text-xs font-semibold text-ink transition hover:bg-wash"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </Popup>
            </>
          )}
        </Map>

        {!pinMode && (
          <MapToolsMenu
            is3D={is3D}
            onToggle3D={() => setIs3D((v) => !v)}
            pitch={pitch}
            bearing={bearing}
            onPitchChange={handlePitchChange}
            onBearingChange={handleBearingChange}
            onResetView={resetMapView}
            basemapOptions={basemapOptions}
            onBasemapChange={setBasemapOptions}
            fogEnabled={fogEnabled}
            onFogEnabledChange={setFogEnabled}
            onInteract={blockMapClick}
          />
        )}

        {!pinMode && popupEntry && mappableEntries.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => browseTo(-1)}
              aria-label="Previous spot"
              className="pointer-events-auto absolute left-3 top-1/2 z-[60] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-2xl leading-none text-ink shadow-md transition hover:bg-wash"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => browseTo(1)}
              aria-label="Next spot"
              className="pointer-events-auto absolute right-3 top-1/2 z-[60] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-2xl leading-none text-ink shadow-md transition hover:bg-wash"
            >
              ›
            </button>
          </>
        )}

        {/* Desktop: floating card beside the pin */}
        {showDesktopPanel && panelPos && popupEntry && (
          <div
            className="pointer-events-none absolute z-[55]"
            style={{
              left: panelPos.left,
              top: panelPos.top,
              width: panelPos.width,
            }}
          >
            <div
              ref={panelRef}
              className="map-detail-panel pointer-events-auto overflow-y-auto overflow-x-hidden hide-scrollbar rounded-2xl border border-line bg-surface shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
              style={{ maxHeight: panelPos.maxHeight }}
              onClick={(e) => e.stopPropagation()}
            >
              <MapPopupCard
                entry={popupEntry}
                onClose={() => {
                  setPopupEntry(null);
                  onSelect(null);
                }}
                onPrev={() => browseTo(-1)}
                onNext={() => browseTo(1)}
                browseIndex={browseIndex >= 0 ? browseIndex : undefined}
                browseTotal={mappableEntries.length}
              />
            </div>
          </div>
        )}

        {!pinMode && (
          <ViewerTicker
            className="absolute left-2 top-[calc(0.5rem+2.25rem+0.5rem)] z-20 sm:left-3"
            viewers={viewers}
            explorerCount={liveExplorers.length}
            showExplorers={showExplorers}
            onToggleExplorers={setShowExplorers}
          />
        )}

        {pinMode && (
          <div className="absolute left-1/2 top-[6.75rem] z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--orange)_45%,white)] bg-[var(--orange)] pl-4 pr-1.5 py-1.5 text-sm font-semibold text-white shadow-md sm:top-[3.75rem]">
            <span className="pointer-events-none whitespace-nowrap">
              Click the map to drop your pin
              {draftPin && (
                <span className="ml-2 font-medium text-white/85">
                  · {draftPin.lat.toFixed(4)}, {draftPin.lng.toFixed(4)}
                </span>
              )}
            </span>
            {onCancelPinMode && (
              <button
                type="button"
                onClick={onCancelPinMode}
                aria-label="Cancel pin placement"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-base leading-none text-white transition hover:bg-white/30"
              >
                ×
              </button>
            )}
          </div>
        )}

        {!pinMode && <FloatingSprites />}
        {!pinMode && <KohCompanion className="hidden sm:flex" />}
      </div>

      {/* Mobile: full-width sheet that squeezes the map upward */}
      {showMobileSheet && popupEntry && (
        <div
          ref={panelRef}
          className="map-mobile-sheet pointer-events-auto relative z-40 w-full shrink-0 overflow-y-auto overflow-x-hidden hide-scrollbar border-t border-line bg-surface"
          style={{
            maxHeight: "min(55dvh, 520px)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <MapPopupCard
            entry={popupEntry}
            onClose={() => {
              setPopupEntry(null);
              onSelect(null);
            }}
            onPrev={() => browseTo(-1)}
            onNext={() => browseTo(1)}
            browseIndex={browseIndex >= 0 ? browseIndex : undefined}
            browseTotal={mappableEntries.length}
          />
        </div>
      )}
    </div>
  );
}
