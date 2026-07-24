import { Redis } from "@upstash/redis";
import type { Player, Sector, SectorEconomy } from "@/lib/gameTypes";
import { STARTING } from "@/lib/gameTypes";
import { buildDummySectors } from "@/lib/devMode";
import { accrueGame } from "@/lib/rules";

const SECTORS_KEY = "itw:v2:sectors";
const PLAYERS_KEY = "itw:v2:players";
const ECONOMY_KEY = "itw:v2:economies";
const INVITE_KEY = "itw:v2:invites";

export const RIVAL_BOT_ID = "bot-ravi";

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

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
  let sectors: Sector[] = [];
  if (!r) {
    sectors = memory.sectors;
  } else {
    const data = await r.get<Sector[]>(SECTORS_KEY);
    sectors = Array.isArray(data) ? data : [];
  }

  if (sectors.length === 0) {
    sectors = buildDummySectors();
    await saveSectors(sectors);
  }
  return sectors;
}

export async function saveSectors(sectors: Sector[]): Promise<void> {
  const r = redis();
  if (!r) {
    memory.sectors = sectors;
    return;
  }
  await r.set(SECTORS_KEY, sectors);
}

function normalizePlayer(raw: Player): Player {
  return {
    ...raw,
    gold: typeof raw.gold === "number" ? raw.gold : 0,
    digBonus: typeof raw.digBonus === "number" ? raw.digBonus : 0,
    villagers: raw.villagers ?? STARTING.villagers,
    houseSlots: raw.houseSlots ?? STARTING.houseSlots,
    housesPlaced: raw.housesPlaced ?? 0,
  };
}

export async function getPlayers(): Promise<Record<string, Player>> {
  const r = redis();
  const data = r
    ? await r.get<Record<string, Player>>(PLAYERS_KEY)
    : memory.players;
  const raw = data && typeof data === "object" ? data : {};
  const out: Record<string, Player> = {};
  for (const [id, p] of Object.entries(raw)) {
    out[id] = normalizePlayer(p);
  }
  return out;
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

function normalizeEconomy(raw: SectorEconomy, sectorId: string): SectorEconomy {
  const legacy = raw as SectorEconomy & { resources?: number };
  return {
    sectorId,
    dugTotal:
      typeof legacy.dugTotal === "number"
        ? legacy.dugTotal
        : typeof legacy.resources === "number"
          ? legacy.resources
          : 0,
    lastTickAt: legacy.lastTickAt || Date.now(),
    controllerId: legacy.controllerId ?? null,
  };
}

export async function getEconomies(): Promise<Record<string, SectorEconomy>> {
  const r = redis();
  const data = r
    ? await r.get<Record<string, SectorEconomy>>(ECONOMY_KEY)
    : memory.economies;
  const raw = data && typeof data === "object" ? data : {};
  const out: Record<string, SectorEconomy> = {};
  for (const [id, eco] of Object.entries(raw)) {
    out[id] = normalizeEconomy(eco, id);
  }
  return out;
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

export async function getInviteOwner(code: string): Promise<string | null> {
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

async function ensureRivalBot(
  players: Record<string, Player>,
  sectors: Sector[],
  now: number
): Promise<Record<string, Player>> {
  const bravo = sectors.find((s) => s.id === "sec_dummy_bravo") ?? sectors[1];
  if (!bravo) return players;

  let bot = players[RIVAL_BOT_ID];
  if (!bot) {
    bot = {
      id: RIVAL_BOT_ID,
      email: "ravi@rival.bot",
      name: "Ravi the Rival",
      image: null,
      inviteCode: "RAVI0001",
      invitedBy: null,
      gold: 12,
      villagers: 1,
      houseSlots: 3,
      housesPlaced: 1,
      activeSectorId: bravo.id,
      digBonus: 0,
      isBot: true,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    // Keep the rival camping Bravo so the map feels alive
    bot = {
      ...bot,
      isBot: true,
      activeSectorId: bravo.id,
      villagers: Math.max(1, bot.villagers),
      housesPlaced: Math.max(1, bot.housesPlaced),
    };
  }
  return { ...players, [RIVAL_BOT_ID]: bot };
}

export async function loadAccruedState(now = Date.now()) {
  const sectors = await getSectors();
  let players = await getPlayers();
  const economies = await getEconomies();

  players = await ensureRivalBot(players, sectors, now);
  const accrued = accrueGame(economies, players, now);

  const changed =
    JSON.stringify(accrued.economies) !== JSON.stringify(economies) ||
    JSON.stringify(accrued.players) !== JSON.stringify(players);

  if (changed) {
    await Promise.all([
      saveEconomies(accrued.economies),
      savePlayers(accrued.players),
    ]);
  }

  return {
    sectors,
    players: accrued.players,
    economies: accrued.economies,
    serverNow: now,
  };
}
