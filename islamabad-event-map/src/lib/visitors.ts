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
const STORAGE_BUCKET = "explore-analytics";
const STORAGE_PREFIX = "visitors";

declare global {
  // eslint-disable-next-line no-var
  var __isbVisitorTouchAt: Map<string, number> | undefined;
  // eslint-disable-next-line no-var
  var __isbVisitorsTableOk: boolean | undefined;
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

function emptyStats(): VisitorStats {
  return {
    allTime: 0,
    thisMonth: 0,
    last30Days: 0,
    today: 0,
    recent: [],
    byMonth: [],
  };
}

function buildStats(rows: VisitorRow[]): VisitorStats {
  const now = new Date();
  const monthStart = startOfUtcMonth(now).getTime();
  const dayStart = startOfUtcDay(now).getTime();
  const thirtyAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;

  const byMonthMap = new Map<string, number>();
  let thisMonth = 0;
  let last30Days = 0;
  let today = 0;

  const sorted = [...rows].sort(
    (a, b) =>
      new Date(b.first_seen).getTime() - new Date(a.first_seen).getTime()
  );

  for (const row of sorted) {
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
    allTime: sorted.length,
    thisMonth,
    last30Days,
    today,
    recent: sorted.slice(0, 40).map((row) => ({
      visitorId: row.visitor_id,
      name: row.name,
      firstSeen: new Date(row.first_seen).getTime(),
      lastSeen: new Date(row.last_seen).getTime(),
      visitCount: row.visit_count || 1,
    })),
    byMonth,
  };
}

function isMissingTableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("could not find the table") ||
    m.includes("schema cache") ||
    m.includes("pgrst205")
  );
}

async function ensureAnalyticsBucket(): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  const { data } = await supabase.storage.listBuckets();
  if (data?.some((b) => b.name === STORAGE_BUCKET || b.id === STORAGE_BUCKET)) {
    return;
  }
  await supabase.storage.createBucket(STORAGE_BUCKET, { public: false });
}

function storagePath(visitorId: string): string {
  return `${STORAGE_PREFIX}/${visitorId}.json`;
}

async function readStorageVisitor(
  visitorId: string
): Promise<VisitorRow | null> {
  const supabase = getSupabaseAdmin()!;
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(storagePath(visitorId));
  if (error || !data) return null;
  try {
    const text = await data.text();
    return JSON.parse(text) as VisitorRow;
  } catch {
    return null;
  }
}

async function writeStorageVisitor(row: VisitorRow): Promise<void> {
  const supabase = getSupabaseAdmin()!;
  await ensureAnalyticsBucket();
  const body = JSON.stringify(row);
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath(row.visitor_id), body, {
      contentType: "application/json",
      upsert: true,
    });
  if (error) throw error;
}

async function listStorageVisitors(): Promise<VisitorRow[]> {
  const supabase = getSupabaseAdmin()!;
  await ensureAnalyticsBucket();
  const { data: files, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list(STORAGE_PREFIX, { limit: 5000 });
  if (error) throw error;
  if (!files?.length) return [];

  const rows: VisitorRow[] = [];
  // Batch downloads in small chunks
  for (let i = 0; i < files.length; i += 20) {
    const chunk = files.slice(i, i + 20);
    const parts = await Promise.all(
      chunk.map(async (file) => {
        if (!file.name.endsWith(".json")) return null;
        const id = file.name.replace(/\.json$/, "");
        return readStorageVisitor(id);
      })
    );
    for (const row of parts) {
      if (row) rows.push(row);
    }
  }
  return rows;
}

async function recordViaTable(input: {
  visitorId: string;
  name: string;
  nowIso: string;
}): Promise<"ok" | "missing_table" | "error"> {
  const supabase = getSupabaseAdmin()!;
  const { visitorId, name, nowIso } = input;

  const { data: existing, error: readError } = await supabase
    .from("visitors")
    .select("visitor_id, name, last_seen, visit_count")
    .eq("visitor_id", visitorId)
    .maybeSingle();

  if (readError) {
    if (isMissingTableError(readError.message)) return "missing_table";
    console.error("Visitor read failed:", readError.message);
    return "error";
  }

  if (!existing) {
    const { error } = await supabase.from("visitors").insert({
      visitor_id: visitorId,
      name,
      first_seen: nowIso,
      last_seen: nowIso,
      visit_count: 1,
    });
    if (error) {
      if (isMissingTableError(error.message)) return "missing_table";
      console.error("Visitor insert failed:", error.message);
      return "error";
    }
    return "ok";
  }

  const lastSeenMs = new Date(existing.last_seen).getTime();
  const newDay =
    Number.isFinite(lastSeenMs) &&
    lastSeenMs < startOfUtcDay(new Date(nowIso)).getTime();

  const { error } = await supabase
    .from("visitors")
    .update({
      name,
      last_seen: nowIso,
      visit_count: newDay
        ? (existing.visit_count || 1) + 1
        : existing.visit_count || 1,
    })
    .eq("visitor_id", visitorId);

  if (error) {
    if (isMissingTableError(error.message)) return "missing_table";
    console.error("Visitor update failed:", error.message);
    return "error";
  }
  return "ok";
}

async function recordViaStorage(input: {
  visitorId: string;
  name: string;
  nowIso: string;
}): Promise<void> {
  const { visitorId, name, nowIso } = input;
  const existing = await readStorageVisitor(visitorId);
  if (!existing) {
    await writeStorageVisitor({
      visitor_id: visitorId,
      name,
      first_seen: nowIso,
      last_seen: nowIso,
      visit_count: 1,
    });
    return;
  }

  const lastSeenMs = new Date(existing.last_seen).getTime();
  const newDay =
    Number.isFinite(lastSeenMs) &&
    lastSeenMs < startOfUtcDay(new Date(nowIso)).getTime();

  await writeStorageVisitor({
    ...existing,
    name,
    last_seen: nowIso,
    visit_count: newDay
      ? (existing.visit_count || 1) + 1
      : existing.visit_count || 1,
  });
}

/**
 * Upsert a durable visitor row on map presence.
 * Prefers the `visitors` SQL table; falls back to Supabase Storage when the
 * table has not been created yet.
 */
export async function recordVisitorVisit(input: {
  visitorId: string;
  name?: string;
}): Promise<void> {
  if (!hasSupabase()) return;
  if (!getSupabaseAdmin()) return;

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

  if (globalThis.__isbVisitorsTableOk !== false) {
    const result = await recordViaTable({ visitorId, name, nowIso });
    if (result === "ok") {
      globalThis.__isbVisitorsTableOk = true;
      return;
    }
    if (result === "missing_table") {
      globalThis.__isbVisitorsTableOk = false;
    } else {
      return;
    }
  }

  try {
    await recordViaStorage({ visitorId, name, nowIso });
  } catch (error) {
    console.error("Visitor storage write failed:", error);
  }
}

export async function getVisitorStats(): Promise<VisitorStats> {
  if (!hasSupabase()) return emptyStats();
  const supabase = getSupabaseAdmin();
  if (!supabase) return emptyStats();

  if (globalThis.__isbVisitorsTableOk !== false) {
    const { data, error } = await supabase
      .from("visitors")
      .select("visitor_id, name, first_seen, last_seen, visit_count")
      .order("first_seen", { ascending: false })
      .limit(5000);

    if (!error) {
      globalThis.__isbVisitorsTableOk = true;
      return buildStats((data as VisitorRow[] | null) ?? []);
    }

    if (isMissingTableError(error.message)) {
      globalThis.__isbVisitorsTableOk = false;
    } else {
      throw new Error(error.message);
    }
  }

  const rows = await listStorageVisitors();
  return buildStats(rows);
}
