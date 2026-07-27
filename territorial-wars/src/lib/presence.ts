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
/** Keep public chat history for a long time — don't wipe on close or short idle */
const CHAT_KEEP_MS = 30 * 24 * 60 * 60_000;
const CHAT_MAX = 300;
const REDIS_KEY = "itw:presence:v1";
const REDIS_CHAT_KEY = "itw:chat:v1";

type PresenceRecord = {
  t: number;
  lat?: number;
  lng?: number;
  name?: string;
  lastMessage?: string;
  lastMessageAt?: number;
};

type PresenceStore = Map<string, PresenceRecord>;
type ChatStore = ChatMessage[];

declare global {
  // eslint-disable-next-line no-var
  var __itwPresenceV1: PresenceStore | undefined;
  // eslint-disable-next-line no-var
  var __itwChatV1: ChatStore | undefined;
}

function memoryStore(): PresenceStore {
  if (!globalThis.__itwPresenceV1) {
    globalThis.__itwPresenceV1 = new Map();
  }
  return globalThis.__itwPresenceV1;
}

function chatMemoryStore(): ChatStore {
  if (!globalThis.__itwChatV1) {
    globalThis.__itwChatV1 = [];
  }
  return globalThis.__itwChatV1;
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
  globalThis.__itwChatV1 = kept;
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

function getRedis(): Redis | null {
  if (!hasRedis()) return null;
  return Redis.fromEnv();
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
  return touchMemory(visitorId, input);
}

export async function getPresenceSnapshot(): Promise<PresenceSnapshot> {
  if (hasRedis()) {
    try {
      return await listRedis();
    } catch (error) {
      console.error("Redis presence list failed:", error);
    }
  }
  return countMemory();
}

export function hasSharedPresenceStore(): boolean {
  return hasRedis();
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
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseChat(raw: unknown): ChatMessage | null {
  try {
    const m =
      typeof raw === "string"
        ? (JSON.parse(raw) as ChatMessage)
        : (raw as ChatMessage);
    if (
      !m ||
      typeof m.id !== "string" ||
      typeof m.visitorId !== "string" ||
      typeof m.name !== "string" ||
      typeof m.text !== "string" ||
      typeof m.t !== "number"
    ) {
      return null;
    }
    return {
      id: m.id,
      visitorId: m.visitorId,
      name: m.name.slice(0, 32),
      text: m.text.slice(0, 140),
      t: m.t,
    };
  } catch {
    return null;
  }
}

async function listChatRedis(): Promise<ChatMessage[]> {
  const redis = getRedis()!;
  const raw = await redis.lrange(REDIS_CHAT_KEY, 0, CHAT_MAX - 1);
  const messages: ChatMessage[] = [];
  const now = Date.now();
  for (const item of raw ?? []) {
    const m = parseChat(item);
    if (m && now - m.t <= CHAT_KEEP_MS) messages.push(m);
  }
  return messages.reverse();
}

async function postChatRedis(message: ChatMessage): Promise<ChatMessage[]> {
  const redis = getRedis()!;
  await redis.lpush(REDIS_CHAT_KEY, JSON.stringify(message));
  await redis.ltrim(REDIS_CHAT_KEY, 0, CHAT_MAX - 1);
  await redis.expire(REDIS_CHAT_KEY, Math.ceil(CHAT_KEEP_MS / 1000));
  return listChatRedis();
}

function postChatMemory(message: ChatMessage): ChatMessage[] {
  const list = pruneChatMemory();
  list.push(message);
  globalThis.__itwChatV1 = list.slice(-CHAT_MAX);
  return [...globalThis.__itwChatV1!];
}

export async function listChatMessages(): Promise<ChatMessage[]> {
  if (hasRedis()) {
    try {
      return await listChatRedis();
    } catch (error) {
      console.error("Redis chat list failed:", error);
    }
  }
  return pruneChatMemory();
}

export async function postChatMessage(input: {
  visitorId: string;
  name: string;
  text: string;
}): Promise<{ messages: ChatMessage[]; message: ChatMessage } | null> {
  const text = input.text.trim().slice(0, 140);
  const name = input.name.trim().slice(0, 32);
  if (!text || name.length < 2) return null;

  const message: ChatMessage = {
    id: newChatId(),
    visitorId: input.visitorId,
    name,
    text,
    t: Date.now(),
  };

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

  return { messages: postChatMemory(message), message };
}
