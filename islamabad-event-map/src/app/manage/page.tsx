"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type Category,
  type EntryType,
} from "@/lib/constants";
import type { Entry, EntryStatus } from "@/lib/types";

type StatusFilter = "all" | EntryStatus;

const jsonHeaders: HeadersInit = {
  "Content-Type": "application/json",
};

function statusTone(status: EntryStatus): string {
  if (status === "approved") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (status === "rejected") return "bg-red-500/15 text-red-700 dark:text-red-300";
  return "bg-amber-500/15 text-amber-800 dark:text-amber-200";
}

function formatAddedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ManagePage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [submitterFilter, setSubmitterFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/entries");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not load entries");
      }
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (err) {
      setEntries([]);
      setError(err instanceof Error ? err.message : "Could not load entries");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitterCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      const id = e.submitterId?.trim();
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (submitterFilter && e.submitterId !== submitterFilter) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.organizerName.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        (e.locationText ?? "").toLowerCase().includes(q) ||
        (e.submitterId ?? "").toLowerCase().includes(q)
      );
    });
  }, [entries, statusFilter, submitterFilter, query]);

  const counts = useMemo(() => {
    const c = { all: entries.length, pending: 0, approved: 0, rejected: 0 };
    for (const e of entries) c[e.status] += 1;
    return c;
  }, [entries]);

  const patchEntry = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/entries/${id}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      const next = data.entry as Entry;
      setEntries((prev) => prev.map((e) => (e.id === id ? next : e)));
      setEditing((cur) => (cur?.id === id ? next : cur));
      setToast("Saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  const removeEntry = async (id: string) => {
    if (!window.confirm("Delete this entry permanently from Airtable?")) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/entries/${id}`, {
        method: "DELETE",
        headers: jsonHeaders,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setEditing((cur) => (cur?.id === id ? null : cur));
      setToast("Deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="min-h-dvh bg-wash text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-base font-semibold sm:text-lg">
              Manage entries
            </h1>
            <p className="text-xs text-ink-muted">
              {counts.pending} pending · {counts.approved} approved ·{" "}
              {counts.rejected} rejected
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink"
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["pending", "Pending"],
              ["approved", "Approved"],
              ["rejected", "Rejected"],
              ["all", "All"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                statusFilter === key
                  ? "border-transparent bg-[var(--btn)] text-white"
                  : "border-line bg-surface text-ink-muted hover:text-ink"
              }`}
            >
              {label}
              <span className="ml-1 tabular-nums opacity-80">
                {counts[key]}
              </span>
            </button>
          ))}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, organizer…"
            className="ml-auto min-w-[180px] flex-1 rounded-full border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:border-[var(--ring)] sm:max-w-xs"
          />
        </div>

        {submitterFilter && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink-muted">
            <span>
              Showing device{" "}
              <span className="font-mono font-semibold text-ink">
                {submitterFilter.slice(0, 8)}…
              </span>{" "}
              · {submitterCounts.get(submitterFilter) ?? 0} total entries
            </span>
            <button
              type="button"
              onClick={() => setSubmitterFilter(null)}
              className="rounded-full border border-line px-2.5 py-1 font-semibold text-ink hover:bg-wash"
            >
              Clear device filter
            </button>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {loading && entries.length === 0 ? (
          <p className="mt-8 text-center text-sm text-ink-muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="mt-8 text-center text-sm text-ink-muted">
            No entries in this view.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {filtered.map((entry) => (
              <li
                key={entry.id}
                className="rounded-2xl border border-line bg-surface p-3 shadow-sm sm:p-4"
              >
                <div className="flex flex-wrap items-start gap-3">
                  {entry.imageUrls && entry.imageUrls.length > 0 ? (
                    <div className="flex shrink-0 gap-1.5">
                      {entry.imageUrls.slice(0, 3).map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="relative h-16 w-16 overflow-hidden rounded-xl border border-line bg-wash"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-line bg-wash text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                      No photo
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusTone(entry.status)}`}
                      >
                        {entry.status}
                      </span>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                        {entry.type} · {CATEGORY_LABELS[entry.category]}
                      </span>
                      {entry.createdTime && (
                        <span className="text-[10px] text-ink-muted">
                          Added {formatAddedAt(entry.createdTime)}
                        </span>
                      )}
                    </div>
                    <h2 className="mt-1 text-sm font-semibold sm:text-base">
                      {entry.title}
                    </h2>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      by {entry.organizerName || "—"}
                      {entry.locationText ? ` · ${entry.locationText}` : ""}
                      {entry.lat != null && entry.lng != null
                        ? ` · ${entry.lat.toFixed(4)}, ${entry.lng.toFixed(4)}`
                        : ""}
                    </p>
                    {entry.submitterId && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="font-mono text-ink-muted">
                          device {entry.submitterId.slice(0, 8)}
                        </span>
                        {(submitterCounts.get(entry.submitterId) ?? 0) > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setSubmitterFilter(entry.submitterId!)
                            }
                            className="rounded-full border border-amber-600/30 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-800 hover:bg-amber-500/20 dark:text-amber-200"
                          >
                            Same device ·{" "}
                            {submitterCounts.get(entry.submitterId)} entries
                          </button>
                        )}
                      </div>
                    )}
                    {entry.description && (
                      <p className="mt-2 line-clamp-2 text-xs text-ink-muted">
                        {entry.description}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {entry.status !== "approved" && (
                      <button
                        type="button"
                        disabled={busyId === entry.id}
                        onClick={() =>
                          void patchEntry(entry.id, { status: "approved" })
                        }
                        className="rounded-full border border-emerald-600/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-50 dark:text-emerald-300"
                      >
                        Approve
                      </button>
                    )}
                    {entry.status !== "rejected" && (
                      <button
                        type="button"
                        disabled={busyId === entry.id}
                        onClick={() =>
                          void patchEntry(entry.id, { status: "rejected" })
                        }
                        className="rounded-full border border-red-600/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50 dark:text-red-300"
                      >
                        Reject
                      </button>
                    )}
                    {entry.status !== "pending" && (
                      <button
                        type="button"
                        disabled={busyId === entry.id}
                        onClick={() =>
                          void patchEntry(entry.id, { status: "pending" })
                        }
                        className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-50"
                      >
                        Pending
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setEditing((cur) =>
                          cur?.id === entry.id ? null : entry
                        )
                      }
                      className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink"
                    >
                      {editing?.id === entry.id ? "Close" : "Edit"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === entry.id}
                      onClick={() => void removeEntry(entry.id)}
                      className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-danger disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {editing?.id === entry.id && (
                  <EditForm
                    entry={editing}
                    busy={busyId === entry.id}
                    onSave={(body) => void patchEntry(entry.id, body)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium shadow-lg">
          {toast}
        </div>
      )}
    </main>
  );
}

function EditForm({
  entry,
  busy,
  onSave,
}: {
  entry: Entry;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState(entry.title);
  const [type, setType] = useState<EntryType>(entry.type);
  const [category, setCategory] = useState<Category>(entry.category);
  const [organizerName, setOrganizerName] = useState(entry.organizerName);
  const [description, setDescription] = useState(
    (entry.description ?? "")
      .replace(/^Contact:\s*.+$/im, "")
      .replace(/^Organizer:\s*.+$/im, "")
      .trim()
  );
  const [locationText, setLocationText] = useState(entry.locationText ?? "");
  const [lat, setLat] = useState(entry.lat?.toString() ?? "");
  const [lng, setLng] = useState(entry.lng?.toString() ?? "");
  const [sourceUrl, setSourceUrl] = useState(entry.sourceUrl ?? "");
  const [contactPhone, setContactPhone] = useState(entry.contactPhone ?? "");
  const [eventDate, setEventDate] = useState(entry.eventDate ?? "");
  const [eventEndDate, setEventEndDate] = useState(entry.eventEndDate ?? "");

  useEffect(() => {
    setTitle(entry.title);
    setType(entry.type);
    setCategory(entry.category);
    setOrganizerName(entry.organizerName);
    setDescription(
      (entry.description ?? "")
        .replace(/^Contact:\s*.+$/im, "")
        .replace(/^Organizer:\s*.+$/im, "")
        .trim()
    );
    setLocationText(entry.locationText ?? "");
    setLat(entry.lat?.toString() ?? "");
    setLng(entry.lng?.toString() ?? "");
    setSourceUrl(entry.sourceUrl ?? "");
    setContactPhone(entry.contactPhone ?? "");
    setEventDate(entry.eventDate ?? "");
    setEventEndDate(entry.eventEndDate ?? "");
  }, [entry]);

  return (
    <form
      className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          title: title.trim(),
          type,
          category,
          organizerName: organizerName.trim(),
          description: description.trim(),
          locationText: locationText.trim() || null,
          lat: lat.trim() === "" ? null : Number(lat),
          lng: lng.trim() === "" ? null : Number(lng),
          sourceUrl: sourceUrl.trim() || null,
          contactPhone: contactPhone.trim() || null,
          eventDate: eventDate.trim() || null,
          eventEndDate: eventEndDate.trim() || null,
        });
      }}
    >
      <label className="block text-xs font-medium text-ink-muted sm:col-span-2">
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="mt-1 w-full rounded-lg border border-line bg-wash px-2.5 py-2 text-sm text-ink"
        />
      </label>
      <label className="block text-xs font-medium text-ink-muted">
        Type
        <select
          value={type}
          onChange={(e) => setType(e.target.value as EntryType)}
          className="mt-1 w-full rounded-lg border border-line bg-wash px-2.5 py-2 text-sm text-ink"
        >
          <option value="place">Place</option>
          <option value="event">Event</option>
        </select>
      </label>
      <label className="block text-xs font-medium text-ink-muted">
        Category
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          className="mt-1 w-full rounded-lg border border-line bg-wash px-2.5 py-2 text-sm text-ink"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-medium text-ink-muted sm:col-span-2">
        Organizer
        <input
          value={organizerName}
          onChange={(e) => setOrganizerName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-wash px-2.5 py-2 text-sm text-ink"
        />
      </label>
      <label className="block text-xs font-medium text-ink-muted sm:col-span-2">
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-line bg-wash px-2.5 py-2 text-sm text-ink"
        />
      </label>
      <label className="block text-xs font-medium text-ink-muted sm:col-span-2">
        Location text
        <input
          value={locationText}
          onChange={(e) => setLocationText(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-wash px-2.5 py-2 text-sm text-ink"
        />
      </label>
      <label className="block text-xs font-medium text-ink-muted">
        Lat
        <input
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          inputMode="decimal"
          className="mt-1 w-full rounded-lg border border-line bg-wash px-2.5 py-2 text-sm text-ink"
        />
      </label>
      <label className="block text-xs font-medium text-ink-muted">
        Lng
        <input
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          inputMode="decimal"
          className="mt-1 w-full rounded-lg border border-line bg-wash px-2.5 py-2 text-sm text-ink"
        />
      </label>
      <label className="block text-xs font-medium text-ink-muted">
        Contact phone
        <input
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-wash px-2.5 py-2 text-sm text-ink"
        />
      </label>
      <label className="block text-xs font-medium text-ink-muted">
        Source URL
        <input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-wash px-2.5 py-2 text-sm text-ink"
        />
      </label>
      {type === "event" && (
        <>
          <label className="block text-xs font-medium text-ink-muted">
            Event date
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-wash px-2.5 py-2 text-sm text-ink"
            />
          </label>
          <label className="block text-xs font-medium text-ink-muted">
            Event end
            <input
              type="date"
              value={eventEndDate}
              onChange={(e) => setEventEndDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-wash px-2.5 py-2 text-sm text-ink"
            />
          </label>
        </>
      )}
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="btn-primary rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
