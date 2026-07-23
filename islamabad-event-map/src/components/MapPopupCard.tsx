"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_LABELS } from "@/lib/constants";
import type { Comment, Entry } from "@/lib/types";
import {
  entryBodyText,
  entryContactPhone,
  entryOrganizerName,
  formatEventSchedule,
  getEntryImages,
  happeningSoonLabel,
  truncate,
} from "@/lib/utils";
import { categoryColor } from "@/components/CategoryIcon";
import { loadSavedCommentName, saveCommentName } from "@/lib/commentAuthor";

interface MapPopupCardProps {
  entry: Entry;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  browseIndex?: number;
  browseTotal?: number;
}

const COMMENT_PREVIEW = 2;

function seedCount(id: string, base: number, span: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return base + (hash % span);
}

/** Instagram-style relative time: 5m, 2h, 3d */
function formatCommentTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hues = [12, 32, 160, 200, 260, 320];
  const h = hues[hash % hues.length];
  return `hsl(${h} 55% 42%)`;
}

export function MapPopupCard({
  entry,
  onClose,
  onPrev,
  onNext,
  browseTotal = 0,
}: MapPopupCardProps) {
  const [liked, setLiked] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [authorName, setAuthorName] = useState(() => loadSavedCommentName());
  const [namePromptOpen, setNamePromptOpen] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [posting, setPosting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);

  const images = useMemo(() => getEntryImages(entry), [entry]);
  const image = images[0]!;
  /** Prefer real uploads for the hero slider; otherwise a single fallback */
  const slides = useMemo(
    () => (entry.imageUrls?.length ? entry.imageUrls : [image]),
    [entry.imageUrls, image]
  );
  const isSlider = slides.length > 1;
  const schedule = formatEventSchedule(entry);
  const body = entryBodyText(entry);
  const contactPhone = entryContactPhone(entry);
  const organizer = entryOrganizerName(entry);
  const isEvent = entry.type === "event";
  const isPending = entry.status === "pending";
  const soonLabel = isEvent && !isPending ? happeningSoonLabel(entry) : null;
  const likeBase = useMemo(() => seedCount(entry.id + "♥", 8, 90), [entry.id]);
  const likeCount = likeBase + (liked ? 1 : 0);
  const hasCoords = entry.lat != null && entry.lng != null;
  const locationLabel = entry.locationText?.trim() ?? "";
  const locationIsTbd = locationLabel.toLowerCase().includes("not finalised");
  const mapsUrl = useMemo(() => {
    if (hasCoords) {
      const q = `${entry.lat},${entry.lng}`;
      const label = encodeURIComponent(entry.title || "Location");
      if (typeof navigator !== "undefined") {
        const ua = navigator.userAgent;
        if (/iPhone|iPad|iPod/i.test(ua)) {
          return `https://maps.apple.com/?ll=${q}&q=${label}`;
        }
      }
      return `https://www.google.com/maps/search/?api=1&query=${q}`;
    }
    if (locationLabel && !locationIsTbd) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationLabel)}`;
    }
    return null;
  }, [hasCoords, entry.lat, entry.lng, entry.title, locationLabel, locationIsTbd]);

  const visibleComments = commentsExpanded
    ? comments
    : comments.slice(0, COMMENT_PREVIEW);
  const hiddenCount = Math.max(0, comments.length - COMMENT_PREVIEW);

  useEffect(() => {
    setLiked(false);
    setSlideIndex(0);
    setReviewText("");
    // authorName is a remembered identity, not per-entry state — leave it be
    setNamePromptOpen(false);
    setComments([]);
    setCommentsExpanded(false);
    setToast(null);
    sliderRef.current?.scrollTo({ left: 0 });
  }, [entry.id]);

  useEffect(() => {
    if (!namePromptOpen) return;
    const t = window.setTimeout(() => nameInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [namePromptOpen]);

  const canBrowse = browseTotal > 1 && onPrev && onNext;

  useEffect(() => {
    if (!canBrowse || namePromptOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        onNext();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canBrowse, namePromptOpen, onNext, onPrev]);

  const onSliderScroll = () => {
    const el = sliderRef.current;
    if (!el || el.clientWidth === 0) return;
    const next = Math.round(el.scrollLeft / el.clientWidth);
    setSlideIndex(Math.max(0, Math.min(next, slides.length - 1)));
  };

  const goToSlide = (index: number) => {
    const el = sliderRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(index, slides.length - 1));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
    setSlideIndex(clamped);
  };

  useEffect(() => {
    let cancelled = false;
    setCommentsLoading(true);
    fetch(`/api/comments?entryId=${encodeURIComponent(entry.id)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setComments(Array.isArray(data.comments) ? data.comments : []);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.id]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const flash = (message: string) => setToast(message);

  const share = async () => {
    const shareData = {
      title: entry.title,
      text: `${entry.title} — Islamabad Explore`,
      url: typeof window !== "undefined" ? window.location.href : "",
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        flash("Shared");
      } else {
        await navigator.clipboard.writeText(
          `${shareData.title}\n${shareData.url}`
        );
        flash("Link copied");
      }
    } catch {
      flash("Share cancelled");
    }
  };

  /** The name dialog doubles as a "change my name" editor (no pending comment) */
  const confirmName = () => {
    if (reviewText.trim()) {
      void postComment();
      return;
    }
    if (authorName.trim()) saveCommentName(authorName.trim());
    setNamePromptOpen(false);
  };

  const requestPost = () => {
    if (!reviewText.trim() || posting) return;
    // Already have a saved name from a previous comment — post right away
    if (authorName.trim()) {
      void postComment();
      return;
    }
    setNamePromptOpen(true);
  };

  const postComment = async () => {
    const text = reviewText.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: entry.id,
          body: text,
          authorName: authorName.trim() || undefined,
          website: "",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        flash(data.error || "Could not post comment");
        return;
      }
      if (data.comment) {
        setComments((prev) => [data.comment as Comment, ...prev]);
        setCommentsExpanded(true);
      }
      if (authorName.trim()) {
        saveCommentName(authorName.trim());
      }
      setReviewText("");
      setNamePromptOpen(false);
      flash(
        authorName.trim()
          ? "Comment posted"
          : `Posted as ${data.comment?.authorName ?? "guest"}`
      );
    } catch {
      flash("Could not post comment");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div
      className="map-popup-card relative w-full overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="relative h-[220px] w-full bg-line sm:h-[240px]">
        <div
          ref={sliderRef}
          onScroll={onSliderScroll}
          className={`flex h-full w-full ${
            isSlider
              ? "snap-x snap-mandatory overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              : "overflow-hidden"
          }`}
        >
          {slides.map((src, i) => (
            <div
              key={`${src}-${i}`}
              className="relative h-full w-full shrink-0 snap-center"
            >
              <Image
                src={src}
                alt=""
                fill
                className="object-cover"
                sizes="100vw"
                priority={i === 0}
              />
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/28 via-black/[0.04] to-transparent" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2 top-2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-xl leading-none text-white backdrop-blur-sm transition hover:bg-black/65"
        >
          ×
        </button>
        <span
          className={`pointer-events-none absolute left-3 top-3 z-10 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white ${
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
          {CATEGORY_LABELS[entry.category]}
        </span>
        {isSlider && (
          <div className="absolute bottom-2.5 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Photo ${i + 1}`}
                aria-current={i === slideIndex}
                onClick={() => goToSlide(i)}
                className={`h-1.5 rounded-full transition ${
                  i === slideIndex
                    ? "w-4 bg-white"
                    : "w-1.5 bg-white/45 hover:bg-white/70"
                }`}
              />
            ))}
          </div>
        )}
        <div
          className={`pointer-events-none absolute left-3 right-3 z-10 ${
            isSlider ? "bottom-7" : "bottom-3"
          }`}
        >
          <h3 className="text-[17px] font-semibold leading-snug text-white drop-shadow">
            {entry.title}
          </h3>
        </div>
      </div>

      <div className="bg-surface">
        {/* Instagram-style actions */}
        <div className="flex items-center gap-4 px-3.5 pt-3">
          <IgAction
            label={liked ? "Unlike" : "Like"}
            onClick={() => setLiked((v) => !v)}
          >
            <HeartIcon filled={liked} className={liked ? "text-[#ed4956]" : ""} />
          </IgAction>
          <IgAction
            label="Comment"
            onClick={() => commentInputRef.current?.focus()}
          >
            <CommentIcon />
          </IgAction>
          <IgAction
            label="Share"
            onClick={() => {
              void share();
            }}
          >
            <ShareIcon />
          </IgAction>
        </div>

        <p className="px-3.5 pt-2 text-sm font-semibold text-ink">
          {likeCount.toLocaleString()} likes
        </p>

        {/* Caption / details */}
        <div className="space-y-1 px-3.5 pt-2 text-sm">
          {isPending && (
            <p className="mb-1 rounded-lg border border-dashed border-[color-mix(in_srgb,var(--pending)_45%,transparent)] bg-[var(--pending-soft)] px-2.5 py-1.5 text-xs font-medium text-[var(--pending-deep)]">
              Awaiting admin review — not verified yet.
            </p>
          )}
          {soonLabel && (
            <span className="soon-badge mb-1">
              <span className="soon-badge-dot" aria-hidden />
              {soonLabel}
            </span>
          )}
          {(organizer || body) && (
            <p className="leading-snug text-ink">
              {organizer && (
                <span className="font-semibold">{organizer} </span>
              )}
              {body && (
                <span className="font-normal text-ink">
                  {truncate(body, 160)}
                </span>
              )}
            </p>
          )}
          {isEvent && (
            <p className="font-medium entry-meta-event">
              {schedule ?? "Date TBA"}
            </p>
          )}
          {(locationLabel && !locationIsTbd) || mapsUrl ? (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {locationLabel && !locationIsTbd && (
                <p className="min-w-0 flex-1 text-ink-muted">{locationLabel}</p>
              )}
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-wash px-2.5 py-1 text-[11px] font-semibold text-ink transition hover:bg-surface"
                >
                  <MapsPinIcon />
                  Open in Maps
                </a>
              )}
            </div>
          ) : null}
          {contactPhone && (
            <a
              href={`tel:${contactPhone.replace(/\s+/g, "")}`}
              className="inline-block font-medium text-[var(--blue)] underline-offset-2 hover:underline"
            >
              {contactPhone}
            </a>
          )}
        </div>

        {/* Comments list */}
        <div className="px-3.5 pt-3">
          {commentsLoading && comments.length === 0 ? (
            <p className="pb-2 text-[12px] text-ink-muted">Loading comments…</p>
          ) : comments.length === 0 ? (
            <p className="pb-2 text-[12px] text-ink-muted">
              No comments yet.
            </p>
          ) : (
            <>
              {hiddenCount > 0 && !commentsExpanded && (
                <button
                  type="button"
                  onClick={() => setCommentsExpanded(true)}
                  className="mb-2 text-[13px] text-ink-muted hover:text-ink"
                >
                  View all {comments.length} comments
                </button>
              )}
              <ul
                className={`space-y-3 ${
                  commentsExpanded
                    ? "max-h-44 overflow-y-auto hide-scrollbar pb-1"
                    : "pb-1"
                }`}
              >
                {visibleComments.map((c) => (
                  <li key={c.id} className="flex gap-2.5">
                    <span
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ backgroundColor: avatarColor(c.authorName) }}
                      aria-hidden
                    >
                      {c.authorName.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug text-ink">
                        <span className="font-semibold">{c.authorName}</span>{" "}
                        <span className="font-normal">{c.body}</span>
                      </p>
                      <p className="mt-1 text-[11px] text-ink-muted">
                        {formatCommentTime(c.createdTime)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              {commentsExpanded && comments.length > COMMENT_PREVIEW && (
                <button
                  type="button"
                  onClick={() => setCommentsExpanded(false)}
                  className="mt-1 mb-1 text-[12px] text-ink-muted hover:text-ink"
                >
                  Show less
                </button>
              )}
            </>
          )}
        </div>

        {entry.sourceUrl && (
          <a
            href={entry.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-3.5 mb-1 inline-block text-sm font-medium text-ink underline-offset-2 hover:underline"
          >
            View source →
          </a>
        )}

        {toast && (
          <p className="mx-3.5 mb-2 rounded-lg bg-wash px-2.5 py-1.5 text-center text-[12px] font-medium text-ink">
            {toast}
          </p>
        )}

        {/* Instagram-style compose bar */}
        <div className="mt-1 border-t border-line px-3.5 py-2.5">
          {authorName.trim() && (
            <div className="mb-1 flex items-center gap-1 text-[11px] text-ink-faint">
              <span>Commenting as {authorName.trim()}</span>
              <button
                type="button"
                onClick={() => setNamePromptOpen(true)}
                className="font-medium text-[var(--blue)] hover:underline"
              >
                change
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              ref={commentInputRef}
              type="text"
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              maxLength={500}
              placeholder="Add a comment..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  requestPost();
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            />
            <button
              type="button"
              disabled={!reviewText.trim() || posting}
              onClick={requestPost}
              className="shrink-0 text-sm font-semibold text-[var(--blue)] disabled:opacity-35"
            >
              Post
            </button>
          </div>
        </div>
      </div>

      {namePromptOpen && (
        <div
          className="absolute inset-0 z-50 flex items-end justify-center bg-black/45 p-3 sm:items-center"
          onClick={(e) => {
            e.stopPropagation();
            if (!posting) setNamePromptOpen(false);
          }}
        >
          <div
            className="w-full max-w-[300px] rounded-2xl border border-line bg-surface p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="comment-name-title"
          >
            <h4
              id="comment-name-title"
              className="text-base font-semibold text-ink"
            >
              Enter your name
            </h4>
            <p className="mt-1 text-[13px] text-ink-muted">
              Leave it blank and we’ll pick a fun name for you.
            </p>
            <input
              ref={nameInputRef}
              type="text"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              maxLength={40}
              placeholder="Your name"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmName();
                }
                if (e.key === "Escape" && !posting) {
                  setNamePromptOpen(false);
                }
              }}
              className="mt-3 w-full rounded-xl border border-line-strong bg-wash px-3 py-2.5 text-sm text-ink outline-none focus:border-[var(--ring)]"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                disabled={posting}
                onClick={() => setNamePromptOpen(false)}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={posting}
                onClick={confirmName}
                className="btn-primary rounded-full border px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                {posting
                  ? "Posting…"
                  : reviewText.trim()
                    ? "Post comment"
                    : "Save name"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MapsPinIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
      <path
        d="M8 1.5a4.2 4.2 0 0 0-4.2 4.2c0 3.15 4.2 8.3 4.2 8.3s4.2-5.15 4.2-8.3A4.2 4.2 0 0 0 8 1.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="5.7" r="1.35" fill="currentColor" />
    </svg>
  );
}

function IgAction({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center text-ink transition hover:opacity-60 active:opacity-40"
    >
      {children}
    </button>
  );
}

function HeartIcon({
  filled,
  className = "",
}: {
  filled?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden
      className={className}
    >
      <path
        d="M12 20.4s-6.8-4.2-9.2-8.1C1.2 9.6 2 6.4 5 5.4c1.9-.6 3.8.2 4.9 1.7C11.1 5.6 13 .8 15 5.4c3 1 3.8 4.2 2.2 7-2.4 3.9-5.2 8-5.2 8Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <path
        d="M20.656 17.008a9.993 9.993 0 1 0-3.59 3.615L22 22Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <path
        d="M22 2 11 13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M22 2 15 22l-4-9-9-4 20-7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
