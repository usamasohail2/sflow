"use client";

import { KohMascot } from "./KohMascot";

/** Koh using the death/lost frames — for the 404 page */
export function KohLost() {
  return (
    <div className="relative flex h-28 w-28 items-center justify-center">
      <span className="absolute inset-0 rounded-full bg-wash" aria-hidden />
      <span
        className="koh-lost-spin absolute inset-3 rounded-full border border-dashed border-line-strong"
        aria-hidden
      />
      <KohMascot size={72} mood="lost" interactive label="Koh is lost" />
      <span
        className="absolute -right-1 top-3 text-xs font-semibold text-ink-faint"
        aria-hidden
      >
        ?
      </span>
    </div>
  );
}
