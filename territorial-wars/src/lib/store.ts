import { Redis } from "@upstash/redis";
import type {
  Player,
  Sector,
  SectorEconomy,
} from "@/lib/gameTypes";
import { RESOURCE_TICK_MS } from "@/lib/gameTypes";

const SECTORS_KEY = "itw:sectors";
const PLAYERS_KEY = "itw:players";
const ECONOMY_KEY = "itw:economies";
const INVITE_KEY = "itw:invites";

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/** In-memory fallback for local/dev when Redis is missing */
const memory = {
  sectors: [] as Sector[],
  players: {} as Record<string, Player>,
  economies: {} as Record<string, SectorEconomy>,
  invites: {} as Record<string, string>,
};

export function isRedisConfigured(): boolean {
  return Boolean(redis());
}

export async function getSectors(): Promise<Sector[]> {
  const r = redis();
  if (!r) return memory.sectors;
  const data = await r.get<Sector[]>(SECTORS_KEY);
  return Array.isArray(data) ? data : [];
}

export async function saveSectors(sectors: Sector[]): Promise<void> {
  const r = redis();
  if (!r) {
    memory.sectors = sectors;
    return;
  }
  await r.set(SECTORS_KEY, sectors);
}

export async function getPlayers(): Promise<Record<string, Player>> {
  const r = redis();
  if (!r) return memory.players;
  const data = await r.get<Record<string, Player>>(PLAYERS_KEY);
  return data && typeof data === "object" ? data : {};
}

export async function savePlayers(
  players: Record<string, Player>
): Promise<void> {
  const r = redis();
  if (!r) {
    memory.players = players;
    return;
  }
  await r.set(PLAYERS_KEY, players);
}

export async function getEconomies(): Promise<Record<string, SectorEconomy>> {
  const r = redis();
  if (!r) return memory.economies;
  const data = await r.get<Record<string, SectorEconomy>>(ECONOMY_KEY);
  return data && typeof data === "object" ? data : {};
}

export async function saveEconomies(
  economies: Record<string, SectorEconomy>
): Promise<void> {
  const r = redis();
  if (!r) {
    memory.economies = economies;
    return;
  }
  await r.set(ECONOMY_KEY, economies);
}

export async function getInviteOwner(
  code: string
): Promise<string | null> {
  const r = redis();
  const key = code.trim().toUpperCase();
  if (!key) return null;
  if (!r) return memory.invites[key] ?? null;
  const owner = await r.hget<string>(INVITE_KEY, key);
  return owner || null;
}

export async function setInviteCode(
  code: string,
  playerId: string
): Promise<void> {
  const r = redis();
  const key = code.trim().toUpperCase();
  if (!r) {
    memory.invites[key] = playerId;
    return;
  }
  await r.hset(INVITE_KEY, { [key]: playerId });
}

export function makeInviteCode(seed: string): string {
  const base = seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base || "ITW"}${rand}`;
}

export function accrueResources(
  economies: Record<string, SectorEconomy>,
  players: Record<string, Player>,
  now = Date.now()
): Record<string, SectorEconomy> {
  const villagersBySector: Record<string, number> = {};
  for (const p of Object.values(players)) {
    if (!p.activeSectorId || p.villagers <= 0) continue;
    villagersBySector[p.activeSectorId] =
      (villagersBySector[p.activeSectorId] ?? 0) + p.villagers;
  }

  const next = { ...economies };
  for (const [sectorId, count] of Object.entries(villagersBySector)) {
    const eco =
      next[sectorId] ??
      ({
        sectorId,
        resources: 0,
        lastTickAt: now,
      } satisfies SectorEconomy);
    const elapsed = Math.max(0, now - eco.lastTickAt);
    const ticks = Math.floor(elapsed / RESOURCE_TICK_MS);
    if (ticks > 0 && count > 0) {
      next[sectorId] = {
        ...eco,
        resources: eco.resources + ticks * count,
        lastTickAt: eco.lastTickAt + ticks * RESOURCE_TICK_MS,
      };
    } else if (!next[sectorId]) {
      next[sectorId] = eco;
    }
  }
  return next;
}

export async function loadAccruedState(now = Date.now()) {
  const [sectors, players, economies] = await Promise.all([
    getSectors(),
    getPlayers(),
    getEconomies(),
  ]);
  const accrued = accrueResources(economies, players, now);
  if (JSON.stringify(accrued) !== JSON.stringify(economies)) {
    await saveEconomies(accrued);
  }
  return { sectors, players, economies: accrued, serverNow: now };
}
