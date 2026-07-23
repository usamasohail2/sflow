import Airtable from "airtable";
import { Redis } from "@upstash/redis";
import type {
  CameraPose,
  ChatMessage,
  PresencePeer,
  PresenceSnapshot,
  TouchPresenceInput,
} from "@/lib/presenceTypes";

export type {
  CameraPose,
  ChatMessage,
  PresencePeer,
  PresenceSnapshot,
  TouchPresenceInput,
} from "@/lib/presenceTypes";

const STALE_MS = 45_000;
const CHAT_KEEP_MS = 30 * 60_000;
const CHAT_MAX = 80;
const REDIS_KEY = "isb:presence:v2";
const REDIS_CHAT_KEY = "isb:chat:v1";
const ENTRIES_TABLE = "Entries";
const PRESENCE_PREFIX = "__presence__:";
const CHAT_PREFIX = "__chat__:";

type PresenceRecord = {
  t: number;
  lat?: number;
  lng?: number;
  name?: string;
  lastMessage?: string;
  lastMessageAt?: number;
};

/** In-memory fallback for local/dev when no shared store is available */
type PresenceStore = Map<string, PresenceRecord>;
type ChatStore = ChatMessage[];

declare global {
  // eslint-disable-next-line no-var
  var __isbPresenceV2: PresenceStore | undefined;
  // eslint-disable-next-line no-var
  var __isbChatV1: ChatStore | undefined;
}

function memoryStore(): PresenceStore {
  if (!globalThis.__isbPresenceV2) {
    globalThis.__isbPresenceV2 = new Map();
  }
  return globalThis.__isbPresenceV2;
}

function chatMemoryStore(): ChatStore {
  if (!globalThis.__isbChatV1) {
    globalThis.__isbChatV1 = [];
  }
  return globalThis.__isbChatV1;
}

function pruneMemory(now = Date.now()) {
  const map = memoryStore();
  map.forEach((record, id) => {
    if (now - record.t > STALE_MS) map.delete(id);
  });
}

function pruneChatMemory(now = Date.now()) {
  const list = chatMemoryStore();
  const kept = list.filter((m) => now - m.t <= CHAT_KEEP_MS).slice(-CHAT_MAX);
  globalThis.__isbChatV1 = kept;
  return kept;
}

function peerFromRecord(id: string, record: PresenceRecord): PresencePeer {
  return {
    id,
    name: record.name,
    lat: record.lat,
    lng: record.lng,
    lastMessage: record.lastMessage,
    lastMessageAt: record.lastMessageAt,
  };
}

function snapshotFromRecords(
  records: Iterable<[string, PresenceRecord]>,
  now = Date.now()
): PresenceSnapshot {
  const peers: PresencePeer[] = [];
  for (const [id, record] of Array.from(records)) {
    if (now - record.t > STALE_MS) continue;
    peers.push(peerFromRecord(id, record));
  }
  return { viewers: peers.length, peers };
}

function mergeRecord(
  prev: PresenceRecord | undefined,
  now: number,
  input?: TouchPresenceInput | null
): PresenceRecord {
  const name =
    typeof input?.name === "string" && input.name.trim()
      ? input.name.trim().slice(0, 32)
      : prev?.name;
  const lastMessage =
    typeof input?.lastMessage === "string" && input.lastMessage.trim()
      ? input.lastMessage.trim().slice(0, 140)
      : prev?.lastMessage;
  const lastMessageAt =
    typeof input?.lastMessageAt === "number" &&
    Number.isFinite(input.lastMessageAt)
      ? input.lastMessageAt
      : input?.lastMessage
        ? now
        : prev?.lastMessageAt;

  return {
    t: now,
    lat: input?.camera?.lat ?? prev?.lat,
    lng: input?.camera?.lng ?? prev?.lng,
    name,
    lastMessage,
    lastMessageAt,
  };
}

function touchMemory(
  visitorId: string,
  input?: TouchPresenceInput | null
): PresenceSnapshot {
  const now = Date.now();
  const map = memoryStore();
  map.set(visitorId, mergeRecord(map.get(visitorId), now, input));
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
      name:
        typeof parsed.name === "string" && parsed.name.trim()
          ? parsed.name.trim().slice(0, 32)
          : undefined,
      lastMessage:
        typeof parsed.lastMessage === "string" && parsed.lastMessage.trim()
          ? parsed.lastMessage.trim().slice(0, 140)
          : undefined,
      lastMessageAt:
        typeof parsed.lastMessageAt === "number" &&
        Number.isFinite(parsed.lastMessageAt)
          ? parsed.lastMessageAt
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
    ...(record.name ? { name: record.name } : {}),
    ...(record.lastMessage ? { lastMessage: record.lastMessage } : {}),
    ...(record.lastMessageAt != null
      ? { lastMessageAt: record.lastMessageAt }
      : {}),
  });
}

/**
 * Shared presence via Airtable Entries (Status=rejected so it never appears
 * on the map). Lat stores last-seen epoch ms; Description holds camera JSON.
 * One record per visitor.
 */
async function touchAirtable(
  visitorId: string,
  input?: TouchPresenceInput | null
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

  const prev =
    existing.length > 0
      ? parseRecordJson(existing[0].fields.Description) ?? undefined
      : undefined;
  const record = mergeRecord(prev, now, input);
  const description = packDescription(record);

  if (existing.length > 0) {
    await base(ENTRIES_TABLE).update([
      {
        id: existing[0].id,
        fields: {
          Lat: now,
          Status: "rejected",
          Description: description,
          ...(record.lng != null ? { Lng: record.lng } : {}),
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
          ...(record.lng != null ? { Lng: record.lng } : {}),
        },
      },
    ]);
  }

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
    if (!packed) continue;
    const lngField =
      typeof row.fields.Lng === "number" ? row.fields.Lng : undefined;
    peers.push({
      ...peerFromRecord(id, packed),
      lng: packed.lng ?? lngField,
    });
  }
  return { viewers: peers.length, peers };
}

function parseRedisValue(raw: unknown): PresenceRecord | null {
  if (typeof raw === "string") return parseRecordJson(raw);
  if (raw && typeof raw === "object" && "t" in raw) {
    return parseRecordJson(JSON.stringify(raw));
  }
  return null;
}

async function touchRedis(
  visitorId: string,
  input?: TouchPresenceInput | null
): Promise<PresenceSnapshot> {
  const redis = getRedis()!;
  const now = Date.now();
  const cutoff = now - STALE_MS;

  const prevRaw = await redis.hget(REDIS_KEY, visitorId);
  const prev = parseRedisValue(prevRaw) ?? undefined;
  const record = mergeRecord(prev, now, input);

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
    peers.push(peerFromRecord(id, parsed));
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
    peers.push(peerFromRecord(id, parsed));
  }

  if (staleIds.length > 0) {
    await redis.hdel(REDIS_KEY, ...staleIds);
  }

  return { viewers: peers.length, peers };
}

export async function touchPresence(
  visitorId: string,
  input?: TouchPresenceInput | null
): Promise<PresenceSnapshot> {
  if (hasRedis()) {
    try {
      return await touchRedis(visitorId, input);
    } catch (error) {
      console.error("Redis presence failed, falling back:", error);
    }
  }

  if (hasAirtable()) {
    try {
      return await touchAirtable(visitorId, input);
    } catch (error) {
      console.error("Airtable presence failed, falling back to memory:", error);
    }
  }

  return touchMemory(visitorId, input);
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

export function isValidDisplayName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= 2 &&
    value.trim().length <= 32 &&
    /^[A-Za-z0-9_\s.'-]+$/.test(value.trim())
  );
}

export function isValidChatText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= 1 &&
    value.trim().length <= 140
  );
}

function newChatId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function parseChatMessage(raw: unknown): ChatMessage | null {
  if (typeof raw === "string") {
    try {
      return parseChatMessage(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Partial<ChatMessage>;
  if (
    typeof obj.id !== "string" ||
    typeof obj.visitorId !== "string" ||
    typeof obj.name !== "string" ||
    typeof obj.text !== "string" ||
    typeof obj.t !== "number"
  ) {
    return null;
  }
  return {
    id: obj.id,
    visitorId: obj.visitorId,
    name: obj.name.slice(0, 32),
    text: obj.text.slice(0, 140),
    t: obj.t,
  };
}

async function listChatRedis(): Promise<ChatMessage[]> {
  const redis = getRedis()!;
  const raw = await redis.lrange(REDIS_CHAT_KEY, 0, CHAT_MAX - 1);
  const now = Date.now();
  const messages: ChatMessage[] = [];
  for (const item of raw ?? []) {
    const parsed = parseChatMessage(item);
    if (!parsed || now - parsed.t > CHAT_KEEP_MS) continue;
    messages.push(parsed);
  }
  // Redis list is newest-first from LPUSH
  return messages.reverse();
}

async function postChatRedis(message: ChatMessage): Promise<ChatMessage[]> {
  const redis = getRedis()!;
  await redis.lpush(REDIS_CHAT_KEY, JSON.stringify(message));
  await redis.ltrim(REDIS_CHAT_KEY, 0, CHAT_MAX - 1);
  await redis.expire(REDIS_CHAT_KEY, Math.ceil(CHAT_KEEP_MS / 1000));
  return listChatRedis();
}

async function listChatAirtable(): Promise<ChatMessage[]> {
  const base = getAirtableBase();
  const cutoff = Date.now() - CHAT_KEEP_MS;
  const rows = await base(ENTRIES_TABLE)
    .select({
      filterByFormula: `AND(FIND('${CHAT_PREFIX}', {Title}) = 1, {Lat} >= ${cutoff})`,
      fields: ["Title", "Description", "Lat"],
      sort: [{ field: "Lat", direction: "asc" }],
      maxRecords: CHAT_MAX,
    })
    .all();

  const messages: ChatMessage[] = [];
  for (const row of rows) {
    const title = String(row.fields.Title ?? "");
    if (!title.startsWith(CHAT_PREFIX)) continue;
    const packed = parseChatMessage(row.fields.Description);
    if (packed) messages.push(packed);
  }
  return messages;
}

async function postChatAirtable(message: ChatMessage): Promise<ChatMessage[]> {
  const base = getAirtableBase();
  await base(ENTRIES_TABLE).create([
    {
      fields: {
        Title: `${CHAT_PREFIX}${message.id}`,
        Type: "Place",
        Category: "other",
        Status: "rejected",
        Lat: message.t,
        Description: JSON.stringify(message),
      },
    },
  ]);

  if (Math.random() < 0.2) {
    try {
      const cutoff = Date.now() - CHAT_KEEP_MS;
      const stale = await base(ENTRIES_TABLE)
        .select({
          filterByFormula: `AND(FIND('${CHAT_PREFIX}', {Title}) = 1, OR({Lat} < ${cutoff}, {Lat} = BLANK()))`,
          maxRecords: 25,
        })
        .firstPage();
      if (stale.length > 0) {
        await base(ENTRIES_TABLE).destroy(stale.map((r) => r.id));
      }
    } catch {
      // ignore
    }
  }

  return listChatAirtable();
}

function postChatMemory(message: ChatMessage): ChatMessage[] {
  const list = pruneChatMemory();
  list.push(message);
  globalThis.__isbChatV1 = list.slice(-CHAT_MAX);
  return [...globalThis.__isbChatV1!];
}

export async function listChatMessages(): Promise<ChatMessage[]> {
  if (hasRedis()) {
    try {
      return await listChatRedis();
    } catch (error) {
      console.error("Redis chat list failed:", error);
    }
  }
  if (hasAirtable()) {
    try {
      return await listChatAirtable();
    } catch (error) {
      console.error("Airtable chat list failed:", error);
    }
  }
  return pruneChatMemory();
}

export async function postChatMessage(input: {
  visitorId: string;
  name: string;
  text: string;
}): Promise<{ messages: ChatMessage[]; message: ChatMessage }> {
  const message: ChatMessage = {
    id: newChatId(),
    visitorId: input.visitorId,
    name: input.name.trim().slice(0, 32),
    text: input.text.trim().slice(0, 140),
    t: Date.now(),
  };

  // Keep presence bubble in sync with the latest line
  await touchPresence(input.visitorId, {
    name: message.name,
    lastMessage: message.text,
    lastMessageAt: message.t,
  });

  if (hasRedis()) {
    try {
      const messages = await postChatRedis(message);
      return { messages, message };
    } catch (error) {
      console.error("Redis chat post failed, falling back:", error);
    }
  }

  if (hasAirtable()) {
    try {
      const messages = await postChatAirtable(message);
      return { messages, message };
    } catch (error) {
      console.error("Airtable chat post failed, falling back:", error);
    }
  }

  return { messages: postChatMemory(message), message };
}
