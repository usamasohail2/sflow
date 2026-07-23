import Airtable from "airtable";
import { Redis } from "@upstash/redis";

const STALE_MS = 45_000;
const REDIS_KEY = "isb:presence";
const ENTRIES_TABLE = "Entries";
const PRESENCE_PREFIX = "__presence__:";

/** In-memory fallback for local/dev when no shared store is available */
type PresenceStore = Map<string, number>;

declare global {
  // eslint-disable-next-line no-var
  var __isbPresence: PresenceStore | undefined;
}

function memoryStore(): PresenceStore {
  if (!globalThis.__isbPresence) {
    globalThis.__isbPresence = new Map();
  }
  return globalThis.__isbPresence;
}

function pruneMemory(now = Date.now()) {
  const map = memoryStore();
  map.forEach((lastSeen, id) => {
    if (now - lastSeen > STALE_MS) map.delete(id);
  });
}

function touchMemory(visitorId: string): number {
  const now = Date.now();
  const map = memoryStore();
  map.set(visitorId, now);
  pruneMemory(now);
  return map.size;
}

function countMemory(): number {
  pruneMemory();
  return memoryStore().size;
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

/**
 * Shared presence via Airtable Entries (Status=rejected so it never appears
 * on the map). Lat stores last-seen epoch ms. One record per visitor.
 */
async function touchAirtable(visitorId: string): Promise<number> {
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

  if (existing.length > 0) {
    await base(ENTRIES_TABLE).update([
      { id: existing[0].id, fields: { Lat: now, Status: "rejected" } },
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
          Description: "Live visitor heartbeat — safe to delete.",
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

  const live = await base(ENTRIES_TABLE)
    .select({
      filterByFormula: `AND(FIND('${PRESENCE_PREFIX}', {Title}) = 1, {Lat} >= ${cutoff})`,
      fields: ["Title"],
    })
    .all();

  return live.length;
}

async function countAirtable(): Promise<number> {
  const base = getAirtableBase();
  const cutoff = Date.now() - STALE_MS;
  const live = await base(ENTRIES_TABLE)
    .select({
      filterByFormula: `AND(FIND('${PRESENCE_PREFIX}', {Title}) = 1, {Lat} >= ${cutoff})`,
      fields: ["Title"],
    })
    .all();
  return live.length;
}

async function touchRedis(visitorId: string): Promise<number> {
  const redis = getRedis()!;
  const now = Date.now();
  const cutoff = now - STALE_MS;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(REDIS_KEY, 0, cutoff);
  pipeline.zadd(REDIS_KEY, { score: now, member: visitorId });
  pipeline.expire(REDIS_KEY, Math.ceil(STALE_MS / 1000) * 3);
  pipeline.zcard(REDIS_KEY);
  const results = await pipeline.exec();
  const count = results[results.length - 1];
  return typeof count === "number" ? count : 0;
}

async function countRedis(): Promise<number> {
  const redis = getRedis()!;
  const now = Date.now();
  await redis.zremrangebyscore(REDIS_KEY, 0, now - STALE_MS);
  return redis.zcard(REDIS_KEY);
}

/**
 * Shared presence across serverless instances.
 * Prefer Upstash Redis when configured; otherwise Airtable; else process memory.
 */
export async function touchPresence(visitorId: string): Promise<number> {
  if (hasRedis()) {
    try {
      return await touchRedis(visitorId);
    } catch (error) {
      console.error("Redis presence failed, falling back:", error);
    }
  }

  if (hasAirtable()) {
    try {
      return await touchAirtable(visitorId);
    } catch (error) {
      console.error("Airtable presence failed, falling back to memory:", error);
    }
  }

  return touchMemory(visitorId);
}

export async function getPresenceCount(): Promise<number> {
  if (hasRedis()) {
    try {
      return await countRedis();
    } catch (error) {
      console.error("Redis presence count failed:", error);
    }
  }

  if (hasAirtable()) {
    try {
      return await countAirtable();
    } catch (error) {
      console.error("Airtable presence count failed:", error);
    }
  }

  return countMemory();
}

export function hasSharedPresenceStore(): boolean {
  return hasRedis() || hasAirtable();
}
