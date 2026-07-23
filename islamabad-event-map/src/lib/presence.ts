import Airtable from "airtable";
import { Redis } from "@upstash/redis";

const STALE_MS = 90_000;
const REDIS_ZKEY = "isb:presence:z";
const REDIS_HKEY = "isb:presence:h";
const ENTRIES_TABLE = "Entries";
const PRESENCE_PREFIX = "__presence__:";
/** Don't hammer Airtable on every camera move — sync at most this often per visitor */
const AIRTABLE_SYNC_MS = 4_000;

export interface ExplorerPresence {
  id: string;
  name: string;
  lat?: number;
  lng?: number;
  color: number;
  lastSeen: number;
}

export interface TouchPresenceInput {
  visitorId: string;
  name?: string;
  lat?: number;
  lng?: number;
  color?: number;
}

type PresenceStore = Map<string, ExplorerPresence>;

declare global {
  // eslint-disable-next-line no-var
  var __isbPresence: PresenceStore | undefined;
  // eslint-disable-next-line no-var
  var __isbAirtableSyncAt: Map<string, number> | undefined;
  // eslint-disable-next-line no-var
  var __isbAirtableSyncing: Set<string> | undefined;
}

function memoryStore(): PresenceStore {
  if (!globalThis.__isbPresence) {
    globalThis.__isbPresence = new Map();
  }
  return globalThis.__isbPresence;
}

function pruneMemory(now = Date.now()) {
  const map = memoryStore();
  map.forEach((rec, id) => {
    if (now - rec.lastSeen > STALE_MS) map.delete(id);
  });
}

function clampName(name: unknown): string {
  if (typeof name !== "string") return "Explorer";
  const trimmed = name.trim().slice(0, 24);
  return trimmed || "Explorer";
}

function clampCoord(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function clampColor(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.abs(Math.floor(value)) % 7;
}

function touchMemory(input: TouchPresenceInput): ExplorerPresence[] {
  const now = Date.now();
  const map = memoryStore();
  const prev = map.get(input.visitorId);
  map.set(input.visitorId, {
    id: input.visitorId,
    name: clampName(input.name ?? prev?.name),
    lat: clampCoord(input.lat) ?? prev?.lat,
    lng: clampCoord(input.lng) ?? prev?.lng,
    color: clampColor(input.color ?? prev?.color ?? 0),
    lastSeen: now,
  });
  pruneMemory(now);
  return listMemory();
}

function listMemory(): ExplorerPresence[] {
  pruneMemory();
  return Array.from(memoryStore().values());
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

function encodeAirtableDescription(
  lastSeen: number,
  color: number
): string {
  return `ts=${lastSeen};color=${color}`;
}

function parseAirtableDescription(raw: unknown): {
  lastSeen: number;
  color: number;
} {
  const text = String(raw ?? "");
  const tsMatch = text.match(/ts=(\d+)/);
  const colorMatch = text.match(/color=(\d+)/);
  return {
    lastSeen: tsMatch ? Number(tsMatch[1]) : 0,
    color: colorMatch ? Number(colorMatch[1]) % 7 : 0,
  };
}

async function touchAirtable(
  input: TouchPresenceInput
): Promise<ExplorerPresence[]> {
  const base = getAirtableBase();
  const now = Date.now();
  const cutoff = now - STALE_MS;
  const title = `${PRESENCE_PREFIX}${input.visitorId}`;
  const escaped = escapeFormula(title);
  const name = clampName(input.name);
  const lat = clampCoord(input.lat);
  const lng = clampCoord(input.lng);
  const color = clampColor(input.color);

  const existing = await base(ENTRIES_TABLE)
    .select({
      filterByFormula: `{Title} = '${escaped}'`,
      maxRecords: 1,
    })
    .firstPage();

  const fields: {
    Title: string;
    Type: string;
    Category: string;
    Status: string;
    Organizer: string;
    Description: string;
    Lat?: number;
    Lng?: number;
  } = {
    Title: title,
    Type: "Place",
    Category: "hidden",
    Status: "rejected",
    Organizer: name,
    Description: encodeAirtableDescription(now, color),
  };
  if (lat != null) fields.Lat = lat;
  if (lng != null) fields.Lng = lng;

  if (existing.length > 0) {
    const prev = existing[0].fields as {
      Lat?: number;
      Lng?: number;
    };
    if (lat == null && typeof prev.Lat === "number") fields.Lat = prev.Lat;
    if (lng == null && typeof prev.Lng === "number") fields.Lng = prev.Lng;
    await base(ENTRIES_TABLE).update([{ id: existing[0].id, fields }]);
  } else {
    await base(ENTRIES_TABLE).create([{ fields }]);
  }

  if (Math.random() < 0.15) {
    try {
      const allPresence = await base(ENTRIES_TABLE)
        .select({
          filterByFormula: `FIND('${PRESENCE_PREFIX}', {Title}) = 1`,
          fields: ["Title", "Description"],
          maxRecords: 50,
        })
        .firstPage();
      const staleIds = allPresence
        .filter((r) => {
          const { lastSeen } = parseAirtableDescription(r.fields.Description);
          return !lastSeen || lastSeen < cutoff;
        })
        .map((r) => r.id);
      if (staleIds.length > 0) {
        await base(ENTRIES_TABLE).destroy(staleIds.slice(0, 20));
      }
    } catch {
      // ignore prune errors
    }
  }

  return listAirtable();
}

async function listAirtable(): Promise<ExplorerPresence[]> {
  const base = getAirtableBase();
  const cutoff = Date.now() - STALE_MS;
  const live = await base(ENTRIES_TABLE)
    .select({
      filterByFormula: `FIND('${PRESENCE_PREFIX}', {Title}) = 1`,
      fields: ["Title", "Organizer", "Lat", "Lng", "Description"],
    })
    .all();

  return live
    .map((r) => {
      const title = String(r.fields.Title ?? "");
      const id = title.startsWith(PRESENCE_PREFIX)
        ? title.slice(PRESENCE_PREFIX.length)
        : title;
      const { lastSeen, color } = parseAirtableDescription(
        r.fields.Description
      );
      const lat =
        typeof r.fields.Lat === "number" ? (r.fields.Lat as number) : undefined;
      const lng =
        typeof r.fields.Lng === "number" ? (r.fields.Lng as number) : undefined;
      return {
        id,
        name: clampName(r.fields.Organizer),
        lat,
        lng,
        color,
        lastSeen,
      } satisfies ExplorerPresence;
    })
    .filter((e) => e.id && e.lastSeen >= cutoff);
}

async function touchRedis(
  input: TouchPresenceInput
): Promise<ExplorerPresence[]> {
  const redis = getRedis()!;
  const now = Date.now();
  const cutoff = now - STALE_MS;
  const prevRaw = await redis.hget<string>(REDIS_HKEY, input.visitorId);
  let prev: Partial<ExplorerPresence> = {};
  if (prevRaw) {
    try {
      prev =
        typeof prevRaw === "string"
          ? (JSON.parse(prevRaw) as ExplorerPresence)
          : (prevRaw as ExplorerPresence);
    } catch {
      prev = {};
    }
  }

  const record: ExplorerPresence = {
    id: input.visitorId,
    name: clampName(input.name ?? prev.name),
    lat: clampCoord(input.lat) ?? prev.lat,
    lng: clampCoord(input.lng) ?? prev.lng,
    color: clampColor(input.color ?? prev.color ?? 0),
    lastSeen: now,
  };

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(REDIS_ZKEY, 0, cutoff);
  pipeline.zadd(REDIS_ZKEY, { score: now, member: input.visitorId });
  pipeline.hset(REDIS_HKEY, { [input.visitorId]: JSON.stringify(record) });
  pipeline.expire(REDIS_ZKEY, Math.ceil(STALE_MS / 1000) * 3);
  pipeline.expire(REDIS_HKEY, Math.ceil(STALE_MS / 1000) * 3);
  await pipeline.exec();

  return listRedis();
}

async function listRedis(): Promise<ExplorerPresence[]> {
  const redis = getRedis()!;
  const now = Date.now();
  const cutoff = now - STALE_MS;
  await redis.zremrangebyscore(REDIS_ZKEY, 0, cutoff);

  const ids = await redis.zrange<string[]>(REDIS_ZKEY, 0, -1);
  if (!ids.length) return [];

  const raw = await redis.hmget<Record<string, string>>(
    REDIS_HKEY,
    ...(ids as [string, ...string[]])
  );
  if (!raw) return [];

  const explorers: ExplorerPresence[] = [];
  for (const id of ids) {
    const value = raw[id];
    if (!value) continue;
    try {
      const parsed =
        typeof value === "string"
          ? (JSON.parse(value) as ExplorerPresence)
          : (value as ExplorerPresence);
      if (parsed.lastSeen >= cutoff) {
        explorers.push({
          id,
          name: clampName(parsed.name),
          lat: clampCoord(parsed.lat),
          lng: clampCoord(parsed.lng),
          color: clampColor(parsed.color),
          lastSeen: parsed.lastSeen,
        });
      }
    } catch {
      // skip bad records
    }
  }
  return explorers;
}

export async function touchPresence(
  input: TouchPresenceInput
): Promise<ExplorerPresence[]> {
  // Always update process memory first — fast path for local / same-instance clients
  const live = touchMemory(input);

  if (hasRedis()) {
    try {
      return await touchRedis(input);
    } catch (error) {
      console.error("Redis presence failed, using memory:", error);
      return live;
    }
  }

  if (hasAirtable()) {
    scheduleAirtableSync(input);
  }

  return live;
}

function airtableSyncAt(): Map<string, number> {
  if (!globalThis.__isbAirtableSyncAt) {
    globalThis.__isbAirtableSyncAt = new Map();
  }
  return globalThis.__isbAirtableSyncAt;
}

function airtableSyncing(): Set<string> {
  if (!globalThis.__isbAirtableSyncing) {
    globalThis.__isbAirtableSyncing = new Set();
  }
  return globalThis.__isbAirtableSyncing;
}

/** Fire-and-forget Airtable write, throttled per visitor */
function scheduleAirtableSync(input: TouchPresenceInput) {
  const now = Date.now();
  const last = airtableSyncAt().get(input.visitorId) ?? 0;
  if (now - last < AIRTABLE_SYNC_MS) return;
  if (airtableSyncing().has(input.visitorId)) return;

  airtableSyncAt().set(input.visitorId, now);
  airtableSyncing().add(input.visitorId);
  void touchAirtable(input)
    .catch((error) => {
      console.error("Airtable presence sync failed:", error);
    })
    .finally(() => {
      airtableSyncing().delete(input.visitorId);
    });
}

export async function listPresence(): Promise<ExplorerPresence[]> {
  // Same-process clients: memory is the source of truth for live positions
  const mem = listMemory();
  if (mem.length > 0) return mem;

  if (hasRedis()) {
    try {
      return await listRedis();
    } catch (error) {
      console.error("Redis presence list failed:", error);
    }
  }

  if (hasAirtable()) {
    try {
      return await listAirtable();
    } catch (error) {
      console.error("Airtable presence list failed:", error);
    }
  }

  return mem;
}

export async function getPresenceCount(): Promise<number> {
  const list = await listPresence();
  return list.length;
}

export function hasSharedPresenceStore(): boolean {
  return hasRedis() || hasAirtable();
}
