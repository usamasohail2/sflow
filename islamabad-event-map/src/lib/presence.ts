import Airtable from "airtable";
import { Redis } from "@upstash/redis";
import type {
  CameraPose,
  PresencePeer,
  PresenceSnapshot,
} from "@/lib/presenceTypes";

export type { CameraPose, PresencePeer, PresenceSnapshot } from "@/lib/presenceTypes";

const STALE_MS = 45_000;
const REDIS_KEY = "isb:presence:v2";
const ENTRIES_TABLE = "Entries";
const PRESENCE_PREFIX = "__presence__:";

type PresenceRecord = {
  t: number;
  lat?: number;
  lng?: number;
};

/** In-memory fallback for local/dev when no shared store is available */
type PresenceStore = Map<string, PresenceRecord>;

declare global {
  // eslint-disable-next-line no-var
  var __isbPresenceV2: PresenceStore | undefined;
}

function memoryStore(): PresenceStore {
  if (!globalThis.__isbPresenceV2) {
    globalThis.__isbPresenceV2 = new Map();
  }
  return globalThis.__isbPresenceV2;
}

function pruneMemory(now = Date.now()) {
  const map = memoryStore();
  map.forEach((record, id) => {
    if (now - record.t > STALE_MS) map.delete(id);
  });
}

function snapshotFromRecords(
  records: Iterable<[string, PresenceRecord]>,
  now = Date.now()
): PresenceSnapshot {
  const peers: PresencePeer[] = [];
  for (const [id, record] of Array.from(records)) {
    if (now - record.t > STALE_MS) continue;
    peers.push({
      id,
      lat: record.lat,
      lng: record.lng,
    });
  }
  return { viewers: peers.length, peers };
}

function touchMemory(
  visitorId: string,
  camera?: CameraPose | null
): PresenceSnapshot {
  const now = Date.now();
  const map = memoryStore();
  const prev = map.get(visitorId);
  map.set(visitorId, {
    t: now,
    lat: camera?.lat ?? prev?.lat,
    lng: camera?.lng ?? prev?.lng,
  });
  pruneMemory(now);
  return snapshotFromRecords(map.entries(), now);
}

function countMemory(): PresenceSnapshot {
  pruneMemory();
  return snapshotFromRecords(memoryStore().entries());
}

function hasRedis(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

function hasAirtable(): boolean {
  return Boolean(process.env.AIRTABLE_TOKEN && process.env.AIRTABLE_BASE_ID);
}

function getRedis(): Redis | null {
  if (!hasRedis()) return null;
  return Redis.fromEnv();
}

function getAirtableBase() {
  return new Airtable({ apiKey: process.env.AIRTABLE_TOKEN! }).base(
    process.env.AIRTABLE_BASE_ID!
  );
}

function escapeFormula(value: string): string {
  return value.replace(/'/g, "\\'");
}

function parseRecordJson(raw: unknown): PresenceRecord | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as PresenceRecord;
    if (typeof parsed?.t !== "number" || !Number.isFinite(parsed.t)) {
      return null;
    }
    return {
      t: parsed.t,
      lat:
        typeof parsed.lat === "number" && Number.isFinite(parsed.lat)
          ? parsed.lat
          : undefined,
      lng:
        typeof parsed.lng === "number" && Number.isFinite(parsed.lng)
          ? parsed.lng
          : undefined,
    };
  } catch {
    return null;
  }
}

function packDescription(record: PresenceRecord): string {
  return JSON.stringify({
    t: record.t,
    ...(record.lat != null ? { lat: record.lat } : {}),
    ...(record.lng != null ? { lng: record.lng } : {}),
  });
}

/**
 * Shared presence via Airtable Entries (Status=rejected so it never appears
 * on the map). Lat stores last-seen epoch ms; Description holds camera JSON.
 * One record per visitor.
 */
async function touchAirtable(
  visitorId: string,
  camera?: CameraPose | null
): Promise<PresenceSnapshot> {
  const base = getAirtableBase();
  const now = Date.now();
  const cutoff = now - STALE_MS;
  const title = `${PRESENCE_PREFIX}${visitorId}`;
  const escaped = escapeFormula(title);

  const existing = await base(ENTRIES_TABLE)
    .select({
      filterByFormula: `{Title} = '${escaped}'`,
      maxRecords: 1,
    })
    .firstPage();

  let lat = camera?.lat;
  let lng = camera?.lng;
  if (existing.length > 0 && (lat == null || lng == null)) {
    const prev = parseRecordJson(existing[0].fields.Description);
    lat = lat ?? prev?.lat;
    lng = lng ?? prev?.lng;
  }

  const record: PresenceRecord = { t: now, lat, lng };
  const description = packDescription(record);

  if (existing.length > 0) {
    await base(ENTRIES_TABLE).update([
      {
        id: existing[0].id,
        fields: {
          Lat: now,
          Status: "rejected",
          Description: description,
          ...(lng != null ? { Lng: lng } : {}),
        },
      },
    ]);
  } else {
    await base(ENTRIES_TABLE).create([
      {
        fields: {
          Title: title,
          Type: "Place",
          Category: "other",
          Status: "rejected",
          Lat: now,
          Description: description,
          ...(lng != null ? { Lng: lng } : {}),
        },
      },
    ]);
  }

  // Occasional prune so we don't hammer Airtable every heartbeat
  if (Math.random() < 0.15) {
    try {
      const stale = await base(ENTRIES_TABLE)
        .select({
          filterByFormula: `AND(FIND('${PRESENCE_PREFIX}', {Title}) = 1, OR({Lat} < ${cutoff}, {Lat} = BLANK()))`,
          maxRecords: 20,
        })
        .firstPage();
      if (stale.length > 0) {
        await base(ENTRIES_TABLE).destroy(stale.map((r) => r.id));
      }
    } catch {
      // ignore prune errors
    }
  }

  return listAirtable();
}

async function listAirtable(): Promise<PresenceSnapshot> {
  const base = getAirtableBase();
  const cutoff = Date.now() - STALE_MS;
  const live = await base(ENTRIES_TABLE)
    .select({
      filterByFormula: `AND(FIND('${PRESENCE_PREFIX}', {Title}) = 1, {Lat} >= ${cutoff})`,
      fields: ["Title", "Description", "Lng"],
    })
    .all();

  const peers: PresencePeer[] = [];
  for (const row of live) {
    const title = String(row.fields.Title ?? "");
    if (!title.startsWith(PRESENCE_PREFIX)) continue;
    const id = title.slice(PRESENCE_PREFIX.length);
    if (!id) continue;
    const packed = parseRecordJson(row.fields.Description);
    const lngField =
      typeof row.fields.Lng === "number" ? row.fields.Lng : undefined;
    peers.push({
      id,
      lat: packed?.lat,
      lng: packed?.lng ?? lngField,
    });
  }
  return { viewers: peers.length, peers };
}

function parseRedisValue(raw: unknown): PresenceRecord | null {
  if (typeof raw === "string") return parseRecordJson(raw);
  if (raw && typeof raw === "object" && "t" in raw) {
    const obj = raw as PresenceRecord;
    if (typeof obj.t === "number" && Number.isFinite(obj.t)) {
      return {
        t: obj.t,
        lat:
          typeof obj.lat === "number" && Number.isFinite(obj.lat)
            ? obj.lat
            : undefined,
        lng:
          typeof obj.lng === "number" && Number.isFinite(obj.lng)
            ? obj.lng
            : undefined,
      };
    }
  }
  return null;
}

async function touchRedis(
  visitorId: string,
  camera?: CameraPose | null
): Promise<PresenceSnapshot> {
  const redis = getRedis()!;
  const now = Date.now();
  const cutoff = now - STALE_MS;

  const prevRaw = await redis.hget(REDIS_KEY, visitorId);
  const prev = parseRedisValue(prevRaw);
  const record: PresenceRecord = {
    t: now,
    lat: camera?.lat ?? prev?.lat,
    lng: camera?.lng ?? prev?.lng,
  };

  await redis.hset(REDIS_KEY, { [visitorId]: JSON.stringify(record) });
  await redis.expire(REDIS_KEY, Math.ceil(STALE_MS / 1000) * 3);

  const all = await redis.hgetall<Record<string, string>>(REDIS_KEY);
  const peers: PresencePeer[] = [];
  const staleIds: string[] = [];

  for (const [id, raw] of Object.entries(all ?? {})) {
    const parsed = parseRedisValue(raw);
    if (!parsed || parsed.t < cutoff) {
      staleIds.push(id);
      continue;
    }
    peers.push({ id, lat: parsed.lat, lng: parsed.lng });
  }

  if (staleIds.length > 0) {
    await redis.hdel(REDIS_KEY, ...staleIds);
  }

  return { viewers: peers.length, peers };
}

async function listRedis(): Promise<PresenceSnapshot> {
  const redis = getRedis()!;
  const now = Date.now();
  const cutoff = now - STALE_MS;
  const all = await redis.hgetall<Record<string, string>>(REDIS_KEY);
  const peers: PresencePeer[] = [];
  const staleIds: string[] = [];

  for (const [id, raw] of Object.entries(all ?? {})) {
    const parsed = parseRedisValue(raw);
    if (!parsed || parsed.t < cutoff) {
      staleIds.push(id);
      continue;
    }
    peers.push({ id, lat: parsed.lat, lng: parsed.lng });
  }

  if (staleIds.length > 0) {
    await redis.hdel(REDIS_KEY, ...staleIds);
  }

  return { viewers: peers.length, peers };
}

/**
 * Shared presence across serverless instances.
 * Prefer Upstash Redis when configured; otherwise Airtable; else process memory.
 */
export async function touchPresence(
  visitorId: string,
  camera?: CameraPose | null
): Promise<PresenceSnapshot> {
  if (hasRedis()) {
    try {
      return await touchRedis(visitorId, camera);
    } catch (error) {
      console.error("Redis presence failed, falling back:", error);
    }
  }

  if (hasAirtable()) {
    try {
      return await touchAirtable(visitorId, camera);
    } catch (error) {
      console.error("Airtable presence failed, falling back to memory:", error);
    }
  }

  return touchMemory(visitorId, camera);
}

export async function getPresenceSnapshot(): Promise<PresenceSnapshot> {
  if (hasRedis()) {
    try {
      return await listRedis();
    } catch (error) {
      console.error("Redis presence count failed:", error);
    }
  }

  if (hasAirtable()) {
    try {
      return await listAirtable();
    } catch (error) {
      console.error("Airtable presence count failed:", error);
    }
  }

  return countMemory();
}

/** @deprecated Prefer getPresenceSnapshot().viewers */
export async function getPresenceCount(): Promise<number> {
  const snap = await getPresenceSnapshot();
  return snap.viewers;
}

export function hasSharedPresenceStore(): boolean {
  return hasRedis() || hasAirtable();
}

export function isValidCameraPose(value: unknown): value is CameraPose {
  if (!value || typeof value !== "object") return false;
  const lat = (value as { lat?: unknown }).lat;
  const lng = (value as { lng?: unknown }).lng;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}
