import { Redis } from "@upstash/redis";
import {
  getSupabaseAdmin,
  hasSupabase,
  type ChatRow,
} from "@/lib/supabase";

const MAX_MESSAGES = 80;
const REDIS_KEY = "isb:chat";
const MAX_TEXT = 160;

export interface ChatMessage {
  id: string;
  visitorId: string;
  name: string;
  text: string;
  color: number;
  lat?: number;
  lng?: number;
  /** Meters above local ground / terrain */
  alt?: number;
  createdAt: number;
}

type ChatStore = ChatMessage[];

declare global {
  // eslint-disable-next-line no-var
  var __isbChat: ChatStore | undefined;
}

function memoryStore(): ChatStore {
  if (!globalThis.__isbChat) {
    globalThis.__isbChat = [];
  }
  return globalThis.__isbChat;
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

function clampText(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim().replace(/\s+/g, " ").slice(0, MAX_TEXT);
  return trimmed || null;
}

function clampName(name: unknown): string {
  if (typeof name !== "string") return "Explorer";
  return name.trim().slice(0, 24) || "Explorer";
}

function makeId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function pushMemory(message: ChatMessage): ChatMessage[] {
  const store = memoryStore();
  store.push(message);
  if (store.length > MAX_MESSAGES) {
    store.splice(0, store.length - MAX_MESSAGES);
  }
  return store.slice();
}

function listMemory(since?: number): ChatMessage[] {
  const store = memoryStore();
  if (since == null || !Number.isFinite(since)) return store.slice();
  return store.filter((m) => m.createdAt > since);
}

function rowToMessage(row: ChatRow): ChatMessage {
  return {
    id: row.id,
    visitorId: row.visitor_id,
    name: clampName(row.name),
    text: row.text,
    color:
      typeof row.color === "number" && Number.isFinite(row.color)
        ? Math.abs(Math.floor(row.color)) % 7
        : 0,
    lat:
      typeof row.lat === "number" && Number.isFinite(row.lat)
        ? row.lat
        : undefined,
    lng:
      typeof row.lng === "number" && Number.isFinite(row.lng)
        ? row.lng
        : undefined,
    alt:
      typeof row.alt === "number" && Number.isFinite(row.alt) && row.alt >= 0
        ? Math.min(row.alt, 50_000)
        : undefined,
    createdAt: new Date(row.created_at).getTime() || Date.now(),
  };
}

async function pushSupabase(message: ChatMessage): Promise<ChatMessage> {
  const supabase = getSupabaseAdmin()!;
  const { error } = await supabase.from("chat_messages").insert({
    id: message.id,
    visitor_id: message.visitorId,
    name: message.name,
    text: message.text,
    color: message.color,
    lat: message.lat ?? null,
    lng: message.lng ?? null,
    alt: message.alt ?? null,
    created_at: new Date(message.createdAt).toISOString(),
  });
  if (error) throw error;

  // Keep table small — delete older than the newest MAX_MESSAGES
  if (Math.random() < 0.2) {
    const { data: keep } = await supabase
      .from("chat_messages")
      .select("id")
      .order("created_at", { ascending: false })
      .range(MAX_MESSAGES, MAX_MESSAGES + 40);
    const ids = (keep ?? []).map((r) => r.id as string).filter(Boolean);
    if (ids.length > 0) {
      void supabase
        .from("chat_messages")
        .delete()
        .in("id", ids)
        .then(({ error: delError }) => {
          if (delError) console.error("Supabase chat prune failed:", delError);
        });
    }
  }

  return message;
}

async function listSupabase(since?: number): Promise<ChatMessage[]> {
  const supabase = getSupabaseAdmin()!;
  let query = supabase
    .from("chat_messages")
    .select("id, visitor_id, name, text, color, lat, lng, alt, created_at")
    .order("created_at", { ascending: false })
    .limit(MAX_MESSAGES);

  if (since != null && Number.isFinite(since)) {
    query = query.gt("created_at", new Date(since).toISOString());
  }

  const { data, error } = await query;
  if (error) throw error;
  const messages = (data as ChatRow[] | null)?.map(rowToMessage) ?? [];
  // Query is newest-first; return chronological
  return messages.reverse();
}

async function pushRedis(message: ChatMessage): Promise<ChatMessage[]> {
  const redis = getRedis()!;
  await redis.lpush(REDIS_KEY, JSON.stringify(message));
  await redis.ltrim(REDIS_KEY, 0, MAX_MESSAGES - 1);
  await redis.expire(REDIS_KEY, 60 * 60 * 24);
  return listRedis();
}

async function listRedis(since?: number): Promise<ChatMessage[]> {
  const redis = getRedis()!;
  const raw = await redis.lrange<string[]>(REDIS_KEY, 0, MAX_MESSAGES - 1);
  const messages: ChatMessage[] = [];
  for (const item of raw ?? []) {
    try {
      const parsed =
        typeof item === "string"
          ? (JSON.parse(item) as ChatMessage)
          : (item as unknown as ChatMessage);
      if (!parsed?.id || !parsed?.text) continue;
      messages.push(parsed);
    } catch {
      // skip
    }
  }
  // Redis LPUSH is newest-first; return chronological
  messages.reverse();
  if (since == null || !Number.isFinite(since)) return messages;
  return messages.filter((m) => m.createdAt > since);
}

export async function postChatMessage(input: {
  visitorId: string;
  name?: string;
  text: unknown;
  color?: number;
  lat?: number;
  lng?: number;
  alt?: number;
}): Promise<ChatMessage | null> {
  const text = clampText(input.text);
  if (!text) return null;

  const message: ChatMessage = {
    id: makeId(),
    visitorId: input.visitorId,
    name: clampName(input.name),
    text,
    color:
      typeof input.color === "number" && Number.isFinite(input.color)
        ? Math.abs(Math.floor(input.color)) % 7
        : 0,
    lat:
      typeof input.lat === "number" && Number.isFinite(input.lat)
        ? input.lat
        : undefined,
    lng:
      typeof input.lng === "number" && Number.isFinite(input.lng)
        ? input.lng
        : undefined,
    alt:
      typeof input.alt === "number" && Number.isFinite(input.alt) && input.alt >= 0
        ? Math.min(input.alt, 50_000)
        : undefined,
    createdAt: Date.now(),
  };

  if (hasSupabase()) {
    try {
      await pushSupabase(message);
      pushMemory(message);
      return message;
    } catch (error) {
      console.error("Supabase chat failed, falling back:", error);
    }
  }

  if (hasRedis()) {
    try {
      await pushRedis(message);
      return message;
    } catch (error) {
      console.error("Redis chat failed, falling back to memory:", error);
    }
  }

  pushMemory(message);
  return message;
}

export async function listChatMessages(since?: number): Promise<ChatMessage[]> {
  if (hasSupabase()) {
    try {
      return await listSupabase(since);
    } catch (error) {
      console.error("Supabase chat list failed:", error);
    }
  }

  if (hasRedis()) {
    try {
      return await listRedis(since);
    } catch (error) {
      console.error("Redis chat list failed:", error);
    }
  }
  return listMemory(since);
}
