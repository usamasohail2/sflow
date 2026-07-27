export type HealthLevel = "ok" | "degraded" | "down" | "unknown";

export type ServerHealth = {
  ok: boolean;
  level: HealthLevel;
  checkedAt: number;
  latencyMs: number;
  storage: {
    backend: "supabase" | "redis" | "blob" | "memory";
    reachable: boolean;
    latencyMs: number | null;
    error?: string;
  };
  game: {
    sectors: number;
    players: number;
    events: number;
  };
  env: {
    authSecret: boolean;
    googleOAuth: boolean;
    mapbox: boolean;
    authDisabled: boolean;
  };
  issues: string[];
};

export type ClientHealth = {
  level: HealthLevel;
  online: boolean;
  poll: {
    lastOkAt: number | null;
    lastAttemptAt: number | null;
    lastLatencyMs: number | null;
    failStreak: number;
    lastError: string | null;
  };
  clockSkewMs: number | null;
  localStorage: boolean;
  mapboxToken: boolean;
  snapshotAgeMs: number | null;
  issues: string[];
};

export function levelFromIssues(
  issues: string[],
  hardFail = false
): HealthLevel {
  if (hardFail) return "down";
  if (issues.length === 0) return "ok";
  if (issues.some((i) => /fail|unreachable|offline|crash/i.test(i))) {
    return "down";
  }
  return "degraded";
}

export function healthDotClass(level: HealthLevel): string {
  if (level === "ok") return "bg-[#8fe098]";
  if (level === "degraded") return "bg-[#e8cf8a]";
  if (level === "down") return "bg-[#e88a7a]";
  return "bg-[var(--ink-faint)]";
}

export function healthLabel(level: HealthLevel): string {
  if (level === "ok") return "Healthy";
  if (level === "degraded") return "Degraded";
  if (level === "down") return "Down";
  return "Unknown";
}
