"use client";

import { QuietLoader } from "./LoadingScreen";

export function RouteLoading() {
  return (
    <div className="flex min-h-[calc(100vh-72px)] items-center justify-center bg-surface">
      <QuietLoader label="Loading…" />
    </div>
  );
}
