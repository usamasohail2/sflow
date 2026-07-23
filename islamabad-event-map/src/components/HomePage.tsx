"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EntryList } from "@/components/EntryList";
import { Header } from "@/components/Header";
import { DarkModeToggle } from "@/components/DarkModeToggle";
import { AuthButton } from "@/components/AuthButton";
import { CategoryStrip } from "@/components/CategoryStrip";
import { SubmitForm } from "@/components/SubmitForm";
import { AppSplash, QuietLoader } from "@/components/LoadingScreen";
import { InterestsModal, saveInterests } from "@/components/InterestsModal";
import {
  PublicChat,
  type PublicChatHandle,
} from "@/components/PublicChat";
import type { Category, CityId, DateFilter, ViewFilter } from "@/lib/constants";
import { CATEGORIES, DEFAULT_CITY } from "@/lib/constants";
import type { Entry } from "@/lib/types";
import { entryInCity, matchesDateFilter, sortEntries } from "@/lib/utils";
import {
  loadViewedEntryIds,
  markEntryViewed,
} from "@/lib/viewedEntries";

const EntryMap = dynamic(
  () => import("@/components/EntryMap").then((m) => m.EntryMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-[var(--map-panel)]">
        <QuietLoader label="Loading map…" />
      </div>
    ),
  }
);

export function HomePage() {
  const [allEntries, setAllEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapReadyToShow, setMapReadyToShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewFilter] = useState<ViewFilter>("place");
  const [city, setCity] = useState<CityId>(DEFAULT_CITY);
  const [selectedCategories, setSelectedCategories] = useState<Category[]>([]);
  const [dateFilter] = useState<DateFilter>("upcoming");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flyToEntry, setFlyToEntry] = useState<Entry | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [exitPinModeSignal, setExitPinModeSignal] = useState(0);
  const [introReady, setIntroReady] = useState(false);
  const [sidebarReady, setSidebarReady] = useState(false);
  const [launchCameraDone, setLaunchCameraDone] = useState(false);
  const [showInterests, setShowInterests] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [viewedIds, setViewedIds] = useState<Set<string>>(() => new Set());
  const [draftPin, setDraftPin] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [publicChat, setPublicChat] = useState<PublicChatHandle | null>(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  useEffect(() => {
    setViewedIds(loadViewedEntryIds());
    // Always start on "All" — don't restore a previously saved category filter
  }, []);

  const loadEntries = useCallback(() => {
    setLoading(true);
    fetch("/api/entries")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load entries");
        return res.json();
      })
      .then((data) => setAllEntries(data.entries ?? []))
      .catch(() =>
        setError("Could not load entries. Check your Airtable configuration.")
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    const open = () => setShowSubmit(true);
    window.addEventListener("open-submit", open);
    return () => window.removeEventListener("open-submit", open);
  }, []);

  useEffect(() => {
    if (!showSubmit) {
      setPinMode(false);
      setDraftPin(null);
    } else {
      // Suggest form lives in the list pane — don't leave it behind an expanded map
      setMapExpanded(false);
    }
  }, [showSubmit]);

  const typeEntries = useMemo(() => {
    return allEntries.filter(
      (e) => e.type === viewFilter && entryInCity(e, city)
    );
  }, [allEntries, viewFilter, city]);

  const handleCityChange = useCallback((next: CityId) => {
    setCity(next);
    setSelectedId(null);
    setFlyToEntry(null);
  }, []);

  const availableCategories = useMemo(() => {
    const used = new Set(typeEntries.map((e) => e.category));
    return CATEGORIES.filter((c) => used.has(c));
  }, [typeEntries]);

  const filteredEntries = useMemo(() => {
    let result = typeEntries;

    // Date filter applies to events only; places always pass
    if (viewFilter === "event") {
      result = result.filter((e) => matchesDateFilter(e, dateFilter));
    }

    const sorted = sortEntries(result, viewFilter);

    // Preferred interests float to the top; others stay visible (dulled in UI)
    if (selectedCategories.length === 0) return sorted;
    return [...sorted].sort((a, b) => {
      const aHit = selectedCategories.includes(a.category) ? 0 : 1;
      const bHit = selectedCategories.includes(b.category) ? 0 : 1;
      return aHit - bHit;
    });
  }, [typeEntries, viewFilter, dateFilter, selectedCategories]);

  /** Map shows the full Events/Spots set; category focus only dulls pins */
  const mapEntries = useMemo(() => filteredEntries, [filteredEntries]);

  const handleSelect = useCallback((entry: Entry | null) => {
    setSelectedId(entry?.id ?? null);
    if (entry) {
      setFlyToEntry(entry);
      setViewedIds(markEntryViewed(entry.id));
    } else {
      setFlyToEntry(null);
    }
  }, []);

  const handleListSelect = useCallback((entry: Entry) => {
    setSelectedId(entry.id);
    setFlyToEntry({ ...entry });
    setViewedIds(markEntryViewed(entry.id));
  }, []);

  const suggestDefault =
    viewFilter === "place" ? "place" : "event";

  const openSuggest = useCallback(() => setShowSubmit(true), []);

  const openSuggestAt = useCallback((lat: number, lng: number) => {
    setDraftPin({ lat, lng });
    setPinMode(true);
    setShowSubmit(true);
  }, []);

  const handleIntroDone = useCallback(() => setIntroReady(true), []);
  const handleLaunchCameraDone = useCallback(
    () => setLaunchCameraDone(true),
    []
  );
  const handleMapReadyToShow = useCallback(() => setMapReadyToShow(true), []);

  // Show chrome as soon as the splash is gone — don't wait for the fly-through
  useEffect(() => {
    if (!introReady) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const delay = reduceMotion ? 0 : 80;
    const t = window.setTimeout(() => setSidebarReady(true), delay);
    return () => window.clearTimeout(t);
  }, [introReady]);

  // Mark launch done even if the camera path is skipped / interrupted
  useEffect(() => {
    if (!introReady || launchCameraDone) return;
    const t = window.setTimeout(() => setLaunchCameraDone(true), 4500);
    return () => window.clearTimeout(t);
  }, [introReady, launchCameraDone]);

  const handleCategoriesChange = useCallback((categories: Category[]) => {
    setSelectedCategories(categories);
    saveInterests(categories);
  }, []);

  const handleInterestsContinue = useCallback((categories: Category[]) => {
    setSelectedCategories(categories);
    setShowInterests(false);
  }, []);

  // Interests modal disabled for now — kept in place so it's easy to re-enable.
  // useEffect(() => {
  //   if (!sidebarReady || loading) return;
  //   if (hasSeenInterests()) return;
  //   const t = window.setTimeout(() => setShowInterests(true), 500);
  //   return () => window.clearTimeout(t);
  // }, [sidebarReady, loading]);

  // Never leave the splash waiting forever if the fetch hangs
  useEffect(() => {
    if (!loading) return;
    const t = window.setTimeout(() => setLoading(false), 4000);
    return () => window.clearTimeout(t);
  }, [loading]);

  return (
    <AppSplash ready={!loading && mapReadyToShow} onIntroDone={handleIntroDone}>
      <InterestsModal
        open={showInterests}
        onContinue={handleInterestsContinue}
      />
      <div className="relative h-dvh overflow-hidden">
        {/* Full-bleed map */}
        <div className="absolute inset-0">
          <EntryMap
            entries={mapEntries}
            selectedId={selectedId}
            onSelect={handleSelect}
            flyToEntry={flyToEntry}
            city={city}
            pinMode={showSubmit && pinMode}
            draftPin={draftPin}
            onDraftPinChange={(lat, lng) => setDraftPin({ lat, lng })}
            onCancelPinMode={() => {
              setPinMode(false);
              setExitPinModeSignal((n) => n + 1);
            }}
            onSuggestAt={!showSubmit ? openSuggestAt : undefined}
            animatePins={introReady}
            viewedIds={viewedIds}
            focusedCategories={selectedCategories}
            onLaunchCameraDone={handleLaunchCameraDone}
            onMapReadyToShow={handleMapReadyToShow}
            startLaunchCamera={introReady}
            onPublicChatChange={setPublicChat}
          />
        </div>

        {/* Top chrome — brand centered, controls on the sides */}
        {sidebarReady && (
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 z-30 px-2 pt-2 transition duration-500 sm:px-3 ${
              mapExpanded ? "opacity-90" : "opacity-100"
            }`}
          >
            <div className="relative flex h-9 items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setMapExpanded((v) => !v)}
                aria-expanded={mapExpanded}
                aria-label={mapExpanded ? "Show list" : "Expand map"}
                className="pointer-events-auto relative z-10 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-xs font-semibold text-ink shadow-sm transition hover:bg-wash sm:px-3"
              >
                {mapExpanded ? (
                  <>
                    <CollapseMapIcon />
                    <span className="hidden sm:inline">Show list</span>
                  </>
                ) : (
                  <>
                    <ExpandMapIcon />
                    <span className="hidden sm:inline">Expand map</span>
                  </>
                )}
              </button>

              <div
                className={`pointer-events-none absolute inset-x-0 flex justify-center transition duration-500 ${
                  mapExpanded ? "opacity-0" : "opacity-100"
                }`}
              >
                <div className="pointer-events-auto w-[min(100%,20rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-sm sm:w-[22rem]">
                  <Header
                    variant="sidebar"
                    listingCount={filteredEntries.length}
                    viewFilter={viewFilter}
                    showThemeToggle={false}
                    city={city}
                    onCityChange={handleCityChange}
                  />
                </div>
              </div>

              <div className="pointer-events-auto relative z-10 flex shrink-0 items-center gap-1.5">
                <AuthButton />
                <DarkModeToggle />
              </div>
            </div>
          </div>
        )}

        {/* Floating suggest form */}
        {sidebarReady && showSubmit && (
          <div className="pointer-events-auto absolute inset-x-3 bottom-3 z-40 max-h-[70vh] overflow-y-auto rounded-2xl border border-line bg-surface/95 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.18)] backdrop-blur-md sm:inset-x-auto sm:left-3 sm:w-[min(420px,calc(100%-1.5rem))] sm:p-4">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-ink sm:text-base">
                  Add a spot
                </h2>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Share a café, trail, hangout, or hidden gem.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPinMode(false);
                  setDraftPin(null);
                  setShowSubmit(false);
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line-strong bg-surface px-2.5 py-1 text-xs font-semibold text-ink"
              >
                × Close
              </button>
            </div>
            <SubmitForm
              compact
              defaultType={suggestDefault}
              lockType
              lat={draftPin?.lat}
              lng={draftPin?.lng}
              exitPinModeSignal={exitPinModeSignal}
              onLocationChange={(lat, lng) => {
                if (lat == null || lng == null) {
                  setDraftPin(null);
                } else {
                  setDraftPin({ lat, lng });
                }
              }}
              onPinModeChange={setPinMode}
              onSuccess={() => {
                setDraftPin(null);
                setPinMode(false);
                loadEntries();
              }}
            />
          </div>
        )}

        {/* Floating bottom pieces — hide while a detail card is open */}
        {sidebarReady && !showSubmit && !selectedId && (
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col gap-1.5 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-6 transition duration-500 ${
              mapExpanded ? "translate-y-6 opacity-0" : "opacity-100"
            }`}
            style={{
              background:
                "linear-gradient(to top, color-mix(in srgb, var(--surface) 50%, transparent) 0%, transparent 100%)",
            }}
          >
            {/* Mobile: categories above spots */}
            <div className="sm:hidden">
              <CategoryStrip
                categories={availableCategories}
                selected={selectedCategories}
                onChange={handleCategoriesChange}
              />
            </div>

            {/* Desktop: categories left, chat right */}
            <div className="pointer-events-auto hidden items-end justify-between gap-3 px-3 sm:flex">
              <CategoryStrip
                categories={availableCategories}
                selected={selectedCategories}
                onChange={handleCategoriesChange}
                className="min-w-0 flex-1 px-0 py-1"
              />
              {publicChat ? (
                <PublicChat {...publicChat} layout="desktop" />
              ) : null}
            </div>

            {/* Spots — hidden on mobile while chat is open */}
            <div
              className={`pointer-events-auto ${
                mobileChatOpen ? "hidden sm:block" : ""
              }`}
            >
              {error ? (
                <div className="mx-3 rounded-xl bg-danger-soft px-3 py-3 text-center">
                  <p className="text-sm text-danger">{error}</p>
                </div>
              ) : (
                <EntryList
                  entries={filteredEntries}
                  selectedId={selectedId}
                  onSelect={handleListSelect}
                  loading={loading}
                  viewFilter={viewFilter}
                  animateIn={sidebarReady}
                  viewedIds={viewedIds}
                  focusedCategories={selectedCategories}
                  onAdd={openSuggest}
                />
              )}
            </div>

            {/* Mobile: chat bar below spots; opening it hides spots */}
            {publicChat && (
              <div className="pointer-events-auto px-3 sm:hidden">
                <PublicChat
                  {...publicChat}
                  layout="mobile"
                  open={mobileChatOpen}
                  onOpenChange={setMobileChatOpen}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </AppSplash>
  );
}

function ExpandMapIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CollapseMapIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
