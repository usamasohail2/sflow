import { getSupabaseAdmin, hasSupabase } from "@/lib/supabase";

export type VisitorRow = {
  visitor_id: string;
  name: string;
  first_seen: string;
  last_seen: string;
  visit_count: number;
};

export type VisitorStats = {
  allTime: number;
  thisMonth: number;
  last30Days: number;
  today: number;
  /** Newest first visits */
  recent: Array<{
    visitorId: string;
    name: string;
    firstSeen: number;
    lastSeen: number;
    visitCount: number;
  }>;
  /** Unique first-visits per calendar month (UTC), newest first */
  byMonth: Array<{ month: string; count: number }>;
};

const VISITOR_TOUCH_MS = 5 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __isbVisitorTouchAt: Map<string, number> | undefined;
}

function visitorTouchAt(): Map<string, number> {
  if (!globalThis.__isbVisitorTouchAt) {
    globalThis.__isbVisitorTouchAt = new Map();
  }
  return globalThis.__isbVisitorTouchAt;
}

function startOfUtcDay(d = new Date()): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

function startOfUtcMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Upsert a durable visitor row on map presence.
 * first_seen is set only on insert; last_seen updates at most every 5 minutes.
 * visit_count increments at most once per UTC day.
 */
export async function recordVisitorVisit(input: {
  visitorId: string;
  name?: string;
}): Promise<void> {
  if (!hasSupabase()) return;
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const visitorId = input.visitorId.trim();
  if (!visitorId || visitorId.length < 8) return;

  const now = Date.now();
  const lastTouch = visitorTouchAt().get(visitorId) ?? 0;
  if (now - lastTouch < VISITOR_TOUCH_MS) return;
  visitorTouchAt().set(visitorId, now);

  const nowIso = new Date(now).toISOString();
  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim().slice(0, 24)
      : "Explorer";

  const { data: existing, error: readError } = await supabase
    .from("visitors")
    .select("visitor_id, name, last_seen, visit_count")
    .eq("visitor_id", visitorId)
    .maybeSingle();

  if (readError) {
    // Table missing until SQL is run — don't break the map
    console.error("Visitor read failed:", readError.message);
    return;
  }

  if (!existing) {
    const { error } = await supabase.from("visitors").insert({
      visitor_id: visitorId,
      name,
      first_seen: nowIso,
      last_seen: nowIso,
      visit_count: 1,
    });
    if (error) console.error("Visitor insert failed:", error.message);
    return;
  }

  const lastSeenMs = new Date(existing.last_seen).getTime();
  const newDay =
    Number.isFinite(lastSeenMs) &&
    lastSeenMs < startOfUtcDay(new Date(now)).getTime();

  const { error } = await supabase
    .from("visitors")
    .update({
      name: input.name != null ? name : existing.name,
      last_seen: nowIso,
      visit_count: newDay
        ? (existing.visit_count || 1) + 1
        : existing.visit_count || 1,
    })
    .eq("visitor_id", visitorId);

  if (error) console.error("Visitor update failed:", error.message);
}

export async function getVisitorStats(): Promise<VisitorStats> {
  const empty: VisitorStats = {
    allTime: 0,
    thisMonth: 0,
    last30Days: 0,
    today: 0,
    recent: [],
    byMonth: [],
  };

  if (!hasSupabase()) return empty;
  const supabase = getSupabaseAdmin();
  if (!supabase) return empty;

  const { data, error } = await supabase
    .from("visitors")
    .select("visitor_id, name, first_seen, last_seen, visit_count")
    .order("first_seen", { ascending: false })
    .limit(5000);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data as VisitorRow[] | null) ?? [];
  const now = new Date();
  const monthStart = startOfUtcMonth(now).getTime();
  const dayStart = startOfUtcDay(now).getTime();
  const thirtyAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;

  const byMonthMap = new Map<string, number>();
  let thisMonth = 0;
  let last30Days = 0;
  let today = 0;

  for (const row of rows) {
    const first = new Date(row.first_seen).getTime();
    if (!Number.isFinite(first)) continue;
    if (first >= monthStart) thisMonth += 1;
    if (first >= thirtyAgo) last30Days += 1;
    if (first >= dayStart) today += 1;

    const d = new Date(first);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    byMonthMap.set(key, (byMonthMap.get(key) ?? 0) + 1);
  }

  const byMonth = Array.from(byMonthMap.entries())
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => b.month.localeCompare(a.month));

  return {
    allTime: rows.length,
    thisMonth,
    last30Days,
    today,
    recent: rows.slice(0, 40).map((row) => ({
      visitorId: row.visitor_id,
      name: row.name,
      firstSeen: new Date(row.first_seen).getTime(),
      lastSeen: new Date(row.last_seen).getTime(),
      visitCount: row.visit_count || 1,
    })),
    byMonth,
  };
}
