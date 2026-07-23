"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type Category,
  type EntryType,
} from "@/lib/constants";
import { getOrCreateSubmitterId } from "@/lib/submitterId";

type LocationMode = "map" | "text" | "tbd";

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

type PhotoDraft = {
  id: string;
  file: File;
  previewUrl: string;
};

const fieldClass =
  "w-full rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none transition focus:border-[var(--ring)]";
const labelClass = "mb-1.5 block text-xs font-semibold text-ink";
const segment =
  "inline-flex flex-wrap rounded-full border border-line-strong p-0.5";
const segBtn = (active: boolean) =>
  `rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
    active ? "seg-tab-active" : "seg-tab"
  }`;

interface SubmitFormProps {
  onSuccess?: () => void;
  defaultType?: EntryType;
  /** Hide the Event/Spot toggle and keep defaultType */
  lockType?: boolean;
  compact?: boolean;
  /** Controlled pin from the main map (when provided) */
  lat?: number;
  lng?: number;
  onLocationChange?: (lat: number | undefined, lng: number | undefined) => void;
  onPinModeChange?: (active: boolean) => void;
  /** Increment to leave pin-on-map mode (e.g. map pill ×) */
  exitPinModeSignal?: number;
}

export function SubmitForm({
  onSuccess,
  lockType = false,
  compact = false,
  lat: controlledLat,
  lng: controlledLng,
  onLocationChange,
  onPinModeChange,
  exitPinModeSignal = 0,
}: SubmitFormProps) {
  const [type] = useState<EntryType>("place");
  const [title, setTitle] = useState("");
  const [organizerName, setOrganizerName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [locationMode, setLocationMode] = useState<LocationMode>("map");
  const [internalLat, setInternalLat] = useState<number | undefined>();
  const [internalLng, setInternalLng] = useState<number | undefined>();
  const [locationText, setLocationText] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventEndDate, setEventEndDate] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [photoWarning, setPhotoWarning] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const usesMainMap = Boolean(onLocationChange);
  const lat = usesMainMap ? controlledLat : internalLat;
  const lng = usesMainMap ? controlledLng : internalLng;

  const setCoords = (newLat: number | undefined, newLng: number | undefined) => {
    if (usesMainMap) {
      onLocationChange?.(newLat, newLng);
    } else {
      setInternalLat(newLat);
      setInternalLng(newLng);
    }
  };

  useEffect(() => {
    if (locationMode === "tbd") {
      setLocationMode("map");
    }
  }, [locationMode]);

  useEffect(() => {
    const active = locationMode === "map";
    onPinModeChange?.(active);
    return () => {
      onPinModeChange?.(false);
    };
    // Intentionally only re-run when location mode changes — parent setter is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationMode]);

  useEffect(() => {
    if (exitPinModeSignal > 0 && locationMode === "map") {
      setLocationMode("text");
    }
    // Only react to the signal itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exitPinModeSignal]);

  const clearPhotos = (list: PhotoDraft[]) => {
    for (const photo of list) URL.revokeObjectURL(photo.previewUrl);
  };

  useEffect(() => {
    return () => clearPhotos(photos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addPhotos = (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);

    const incoming = Array.from(files);
    const next: PhotoDraft[] = [];
    for (const file of incoming) {
      if (!file.type.startsWith("image/")) {
        setError("Photos must be image files (JPEG, PNG, WebP, or GIF)");
        continue;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        setError("Each photo must be under 2 MB");
        continue;
      }
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    setPhotos((prev) => {
      const merged = [...prev, ...next].slice(0, MAX_PHOTOS);
      for (const draft of next) {
        if (!merged.includes(draft)) URL.revokeObjectURL(draft.previewUrl);
      }
      if (prev.length + next.length > MAX_PHOTOS) {
        setError(`You can upload up to ${MAX_PHOTOS} photos`);
      }
      return merged;
    });

    if (photoInputRef.current) photoInputRef.current.value = "";
  };

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const resetForm = () => {
    setSuccess(false);
    setPhotoWarning(null);
    setTitle("");
    setOrganizerName("");
    setDescription("");
    setCategory("");
    setCoords(undefined, undefined);
    setLocationText("");
    setLocationMode("map");
    setEventDate("");
    setEventEndDate("");
    setSourceUrl("");
    setContactPhone("");
    setPhotos((prev) => {
      clearPhotos(prev);
      return [];
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!organizerName.trim() || organizerName.trim().length < 2) {
      setError("Your name is required");
      return;
    }
    if (!category) {
      setError("Category is required");
      return;
    }
    if (type === "place") {
      if (locationMode === "map" && (lat == null || lng == null)) {
        setError("Places need a location — pin the map or describe the area");
        return;
      }
      if (locationMode === "text" && !locationText.trim()) {
        setError("Places need a location — describe where it is");
        return;
      }
    }
    if (type === "event") {
      if (locationMode === "map" && (lat == null || lng == null)) {
        setError("Pin a location, describe an area, or mark it as not finalised");
        return;
      }
      if (locationMode === "text" && !locationText.trim()) {
        setError("Describe the location, or choose “Not finalised yet”");
        return;
      }
      if (!eventDate) {
        setError("Event date is required");
        return;
      }
    }

    setSubmitting(true);

    try {
      const form = new FormData();
      form.set("type", type);
      form.set("title", title.trim());
      form.set("organizerName", organizerName.trim());
      if (description.trim()) form.set("description", description.trim());
      form.set("category", category);
      if (locationMode === "map" && lat != null && lng != null) {
        form.set("lat", String(lat));
        form.set("lng", String(lng));
      }
      if (locationMode === "text") {
        form.set("locationText", locationText.trim());
      } else if (locationMode === "tbd") {
        form.set("locationText", "Location not finalised yet");
        form.set("locationTbd", "true");
      } else if (locationMode === "map" && locationText.trim()) {
        form.set("locationText", locationText.trim());
      }
      if (type === "event" && eventDate) form.set("eventDate", eventDate);
      if (type === "event" && eventEndDate) {
        form.set("eventEndDate", eventEndDate);
      }
      if (sourceUrl.trim()) form.set("sourceUrl", sourceUrl.trim());
      if (contactPhone.trim()) form.set("contactPhone", contactPhone.trim());
      form.set("website", honeypot);
      form.set("submitterId", getOrCreateSubmitterId());
      for (const photo of photos) {
        form.append("photos", photo.file);
      }

      const res = await fetch("/api/entries", {
        method: "POST",
        body: form,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Submission failed");
        return;
      }

      setPhotoWarning(
        typeof data.photoWarning === "string" ? data.photoWarning : null
      );
      setSuccess(true);
      onSuccess?.();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="border border-line bg-wash px-4 py-6 text-center">
        <h2 className="font-display text-lg font-medium text-ink">
          Spot submitted
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          It&apos;s on the map now in amber as pending — an admin will verify it.
        </p>
        {photoWarning && (
          <p className="mt-3 rounded-lg border border-dashed border-[color-mix(in_srgb,var(--pending)_45%,transparent)] bg-[var(--pending-soft)] px-3 py-2 text-left text-xs leading-relaxed text-[var(--pending-deep)]">
            {photoWarning}
          </p>
        )}
        <button
          type="button"
          onClick={resetForm}
          className="mt-5 text-sm font-medium text-ink underline underline-offset-4"
        >
          Add another spot
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={compact ? "space-y-4" : "space-y-5"}
    >
      <div className="absolute -left-[9999px]" aria-hidden>
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      {/* Type is always Spot in the public UI */}
      {!lockType && (
        <input type="hidden" name="type" value="place" readOnly />
      )}

      <div>
        <label htmlFor="title" className={labelClass}>
          Title *
        </label>
        <input
          id="title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={fieldClass}
          placeholder="e.g. Jazz Night at PNCA"
        />
      </div>

      <div>
        <label htmlFor="organizerName" className={labelClass}>
          Your name *
        </label>
        <input
          id="organizerName"
          type="text"
          required
          value={organizerName}
          onChange={(e) => setOrganizerName(e.target.value)}
          className={fieldClass}
          placeholder="e.g. Usama"
          autoComplete="name"
          maxLength={80}
        />
        <p className="mt-1 text-[11px] text-ink-muted">
          Shown as “by …” on the listing.
        </p>
      </div>

      <div>
        <label htmlFor="description" className={labelClass}>
          Description
        </label>
        <textarea
          id="description"
          rows={compact ? 2 : 3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={fieldClass}
          placeholder="What should people know?"
        />
      </div>

      <div>
        <label htmlFor="category" className={labelClass}>
          Category *
        </label>
        <select
          id="category"
          required
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          className={fieldClass}
        >
          <option value="">Select a category</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {CATEGORY_LABELS[cat]}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className={labelClass}>
          Location {type === "place" ? "*" : ""}
        </legend>

        {type === "place" && (
          <p className="mb-2 text-xs text-ink-muted">
            Places need a location so people can find them.
          </p>
        )}

        <div className={`mb-3 ${segment}`}>
          <button
            type="button"
            onClick={() => setLocationMode("map")}
            className={segBtn(locationMode === "map")}
          >
            Pin on map
          </button>
          <button
            type="button"
            onClick={() => setLocationMode("text")}
            className={segBtn(locationMode === "text")}
          >
            {type === "place" ? "Describe area" : "Approximate"}
          </button>
          {type === "event" && (
            <button
              type="button"
              onClick={() => setLocationMode("tbd")}
              className={segBtn(locationMode === "tbd")}
            >
              Not finalised
            </button>
          )}
        </div>

        {locationMode === "map" && (
          <div className="space-y-3 rounded-xl border border-[color-mix(in_srgb,var(--blue)_28%,transparent)] bg-[var(--blue-soft)] px-3 py-3">
            {usesMainMap ? (
              <>
                <p className="text-sm font-semibold text-ink">
                  Click the big map to drop a pin
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  Existing pins fade while you place yours. Click again to move it.
                </p>
              </>
            ) : (
              <p className="text-xs text-ink-muted">
                Pin mode needs the main map — open Suggest from the home page.
              </p>
            )}
            {lat != null && lng != null ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[12px] font-medium text-[var(--blue)]">
                  Pinned · {lat.toFixed(5)}, {lng.toFixed(5)}
                </p>
                <button
                  type="button"
                  onClick={() => setCoords(undefined, undefined)}
                  className="text-[12px] font-semibold text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  Clear pin
                </button>
              </div>
            ) : (
              <p className="text-[12px] text-ink-faint">No pin yet</p>
            )}

            <div>
              <label htmlFor="pinAddress" className="mb-1.5 block text-xs font-semibold text-ink">
                Address{" "}
                <span className="font-normal text-ink-muted">(optional)</span>
              </label>
              <input
                id="pinAddress"
                type="text"
                value={locationText}
                onChange={(e) => setLocationText(e.target.value)}
                className={fieldClass}
                placeholder='e.g. "F-7 Markaz, near Super Market"'
              />
            </div>
          </div>
        )}

        {locationMode === "text" && (
          <input
            type="text"
            value={locationText}
            onChange={(e) => setLocationText(e.target.value)}
            className={fieldClass}
            placeholder={
              type === "place"
                ? 'e.g. "F-7 Markaz, near Super Market"'
                : 'e.g. "Somewhere in F-7"'
            }
            required={type === "place"}
          />
        )}

        {locationMode === "tbd" && type === "event" && (
          <p className="border border-line bg-wash px-3 py-2.5 text-xs leading-relaxed text-ink-muted">
            Will show as location not finalised. Update later in Airtable when
            the venue is confirmed.
          </p>
        )}
      </fieldset>

      {type === "event" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="eventDate" className={labelClass}>
              Event date *
            </label>
            <input
              id="eventDate"
              type="date"
              required
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="eventEndDate" className={labelClass}>
              End date
            </label>
            <input
              id="eventEndDate"
              type="date"
              value={eventEndDate}
              min={eventDate || undefined}
              onChange={(e) => setEventEndDate(e.target.value)}
              className={fieldClass}
            />
          </div>
        </div>
      )}

      <div>
        <label className={labelClass}>
          Photos{" "}
          <span className="font-normal text-ink-muted">
            (optional, up to {MAX_PHOTOS})
          </span>
        </label>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="sr-only"
          onChange={(e) => addPhotos(e.target.files)}
        />
        <div className="flex flex-wrap gap-2">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="relative h-20 w-20 overflow-hidden rounded-xl border border-line"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.previewUrl}
                alt=""
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => removePhoto(photo.id)}
                className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-[11px] font-bold text-white"
                aria-label="Remove photo"
              >
                ×
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="flex h-20 w-20 flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-surface text-[11px] font-semibold text-ink-muted transition hover:border-ink-faint hover:text-ink"
            >
              <span className="text-lg leading-none">+</span>
              Add
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-ink-muted">
          JPEG, PNG, WebP, or GIF · max 2 MB each
        </p>
      </div>

      <div>
        <label htmlFor="contactPhone" className={labelClass}>
          Contact number{" "}
          <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <input
          id="contactPhone"
          type="tel"
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
          className={fieldClass}
          placeholder="e.g. 0300 1234567"
          autoComplete="tel"
        />
      </div>

      <div>
        <label htmlFor="sourceUrl" className={labelClass}>
          Source URL{" "}
          <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <input
          id="sourceUrl"
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          className={fieldClass}
          placeholder="https://…"
        />
      </div>

      {error && (
        <p className="border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="btn-primary w-full rounded-xl border px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit for review"}
      </button>
    </form>
  );
}
