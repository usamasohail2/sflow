/**
 * Server-side world NPC tick + mutation helpers.
 * Kept separate from store.ts to keep the state machine readable.
 */
import type { Player, Sector } from "@/lib/gameTypes";
import { isAzadHomeId } from "@/lib/gameTypes";
import { pointInRing } from "@/lib/geo";
import { distMeters, ringCentroid } from "@/lib/mapMath";
import {
  CDA_CHASE_RANGE_M,
  CDA_TRUCK_DRAIN_PER_MIN,
  CDA_TRUCK_MAX_GAP_MS,
  CDA_TRUCK_MIN_GAP_MS,
  CDA_TRUCK_PARK_MS,
  CDA_TRUCK_TRAVEL_MS,
  SPY_SAT_COST,
  SPY_SAT_DESTROY_RANGE_M,
  SPY_SAT_DRAIN_PER_MIN,
  repairWorldNpcTravelClocks,
  worldNpcTravelPos,
  type WorldNpc,
} from "@/lib/worldNpcs";

function nid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

/** Apply gold drain; returns amount actually taken. */
export function drainPlayerGold(
  p: Player,
  want: number,
  now: number
): { player: Player; taken: number } {
  const taken = Math.min(p.gold, Math.max(0, Math.floor(want)));
  if (taken <= 0) return { player: p, taken: 0 };
  return {
    player: { ...p, gold: p.gold - taken, updatedAt: now },
    taken,
  };
}

export function findCdaHq(npcs: WorldNpc[]): WorldNpc | null {
  return npcs.find((n) => n.kind === "cda_hq" && n.phase !== "gone") ?? null;
}

export function placeCdaHqAt(
  npcs: WorldNpc[],
  pos: { lat: number; lng: number },
  adminId: string,
  now = Date.now()
): WorldNpc[] {
  const rest = npcs.filter((n) => n.kind !== "cda_hq");
  const hq: WorldNpc = {
    id: nid("cda_hq"),
    kind: "cda_hq",
    lat: pos.lat,
    lng: pos.lng,
    phase: "idle",
    label: "CDA Head Office",
    ownerPlayerId: adminId,
    createdAt: now,
    updatedAt: now,
    // next dispatch window starts soon so admins can see a truck
    lastDrainAt: now - CDA_TRUCK_MIN_GAP_MS + 90_000,
  };
  return [...rest, hq];
}

function pickTruckVictim(players: Player[]): Player | null {
  const candidates = players.filter((p) => p.homeSectorId && p.house);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}

export function spawnTruck(
  hq: WorldNpc,
  victim: Player,
  now: number
): WorldNpc {
  const to = victim.house!;
  return {
    id: nid("cda_truck"),
    kind: "cda_truck",
    lat: hq.lat,
    lng: hq.lng,
    fromLat: hq.lat,
    fromLng: hq.lng,
    toLat: to.lat,
    toLng: to.lng,
    departAt: now,
    arriveAt: now + CDA_TRUCK_TRAVEL_MS,
    phase: "traveling",
    label: "CDA Raid Truck",
    targetPlayerId: victim.id,
    targetName: victim.name,
    sectorId: victim.homeSectorId,
    lastDrainAt: now,
    drainedTotal: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** Admin/test: spawn a truck immediately with real clocks (no fake future now). */
export function forceDispatchCdaTruck(
  npcs: WorldNpc[],
  players: Player[],
  now = Date.now()
):
  | { npcs: WorldNpc[]; truck: WorldNpc }
  | { error: string } {
  const hq = findCdaHq(npcs);
  if (!hq) return { error: "Place CDA Head Office on the map first" };
  const victim = pickTruckVictim(players);
  if (!victim) {
    return { error: "No settled base to raid — someone must have a house down" };
  }
  const rest = npcs.filter((n) => n.kind !== "cda_truck" && n.phase !== "gone");
  const truck = spawnTruck(hq, victim, now);
  const nextHq = {
    ...hq,
    lastDrainAt: now,
    updatedAt: now,
  };
  return {
    npcs: [
      ...rest.map((n) => (n.kind === "cda_hq" ? nextHq : n)),
      truck,
    ],
    truck,
  };
}

/**
 * Advance travel, parking, drain, and auto-dispatch of CDA trucks + spy sats.
 * Mutates player map in place for drains; returns updated npc list + dirty players.
 */
export function tickWorldNpcs(opts: {
  npcs: WorldNpc[];
  players: Player[];
  now?: number;
}): {
  npcs: WorldNpc[];
  dirtyPlayers: Player[];
  notifications: {
    playerId: string;
    kind: "cda_dispatch" | "cda_arrive" | "cda_leave" | "spy_drain";
    message: string;
    npcId: string;
    targetName?: string;
    drained?: number;
  }[];
} {
  const now = opts.now ?? Date.now();
  const byId = new Map(opts.players.map((p) => [p.id, { ...p }]));
  const dirty = new Set<string>();
  const notifications: {
    playerId: string;
    kind: "cda_dispatch" | "cda_arrive" | "cda_leave" | "spy_drain";
    message: string;
    npcId: string;
    targetName?: string;
    drained?: number;
  }[] = [];

  let npcs = opts.npcs
    .filter((n) => n.phase !== "gone")
    .map((n) => ({ ...n }));

  // Fix trucks stuck with future depart/arrive (looked "en route" forever)
  for (const n of npcs) {
    if (n.kind === "cda_truck") repairWorldNpcTravelClocks(n, now);
  }

  // --- Spy sats drain ---
  for (const n of npcs) {
    if (n.kind !== "spy_sat" || n.phase !== "active") continue;
    if (!n.targetPlayerId) continue;
    const victim = byId.get(n.targetPlayerId);
    if (!victim) {
      n.phase = "gone";
      n.updatedAt = now;
      continue;
    }
    const last = n.lastDrainAt ?? n.createdAt;
    const elapsedMin = (now - last) / 60_000;
    if (elapsedMin < 0.25) continue; // ~15s ticks
    const want = elapsedMin * SPY_SAT_DRAIN_PER_MIN;
    const { player, taken } = drainPlayerGold(victim, want, now);
    n.lastDrainAt = now;
    n.updatedAt = now;
    if (taken > 0) {
      byId.set(victim.id, player);
      dirty.add(victim.id);
      n.drainedTotal = (n.drainedTotal || 0) + taken;
      if (!n.noticedAt) n.noticedAt = now;
    }
  }

  // --- CDA trucks travel / park / drain / leave ---
  for (const n of npcs) {
    if (n.kind !== "cda_truck") continue;

    if (n.phase === "traveling" || n.phase === "fleeing") {
      const pos = worldNpcTravelPos(n, now);
      n.lat = pos.lat;
      n.lng = pos.lng;
      n.updatedAt = now;
      if (n.arriveAt != null && now >= n.arriveAt) {
        if (n.phase === "fleeing") {
          n.phase = "gone";
          n.lat = n.toLat ?? n.lat;
          n.lng = n.toLng ?? n.lng;
        } else {
          n.phase = "parked";
          n.lat = n.toLat ?? n.lat;
          n.lng = n.toLng ?? n.lng;
          n.lastDrainAt = now;
          n.departAt = now; // reuse as park-start
          n.arriveAt = now + CDA_TRUCK_PARK_MS;
          const who = n.targetName || "a settler";
          if (n.targetPlayerId) {
            notifications.push({
              playerId: n.targetPlayerId,
              kind: "cda_arrive",
              message: `CDA Raid Truck parked at ${who}'s base — bribing villagers. Chase it off!`,
              npcId: n.id,
              targetName: who,
            });
          }
        }
      }
      continue;
    }

    if (n.phase === "parked") {
      if (n.targetPlayerId) {
        const victim = byId.get(n.targetPlayerId);
        if (victim) {
          const last = n.lastDrainAt ?? now;
          const elapsedMin = (now - last) / 60_000;
          if (elapsedMin >= 0.2) {
            const want = elapsedMin * CDA_TRUCK_DRAIN_PER_MIN;
            const { player, taken } = drainPlayerGold(victim, want, now);
            n.lastDrainAt = now;
            if (taken > 0) {
              byId.set(victim.id, player);
              dirty.add(victim.id);
              n.drainedTotal = (n.drainedTotal || 0) + taken;
            }
          }
        }
      }
      // Auto-leave after park window
      if (n.arriveAt != null && now >= n.arriveAt) {
        const hq = findCdaHq(npcs);
        const who = n.targetName || "a settler";
        const drained = n.drainedTotal || 0;
        if (hq) {
          n.phase = "fleeing";
          n.fromLat = n.lat;
          n.fromLng = n.lng;
          n.toLat = hq.lat;
          n.toLng = hq.lng;
          n.departAt = now;
          n.arriveAt = now + CDA_TRUCK_TRAVEL_MS;
          if (n.targetPlayerId) {
            notifications.push({
              playerId: n.targetPlayerId,
              kind: "cda_leave",
              message: `CDA Raid Truck left ${who}'s base — drained ◈${drained}`,
              npcId: n.id,
              targetName: who,
              drained,
            });
          }
        } else {
          n.phase = "gone";
          if (n.targetPlayerId) {
            notifications.push({
              playerId: n.targetPlayerId,
              kind: "cda_leave",
              message: `CDA Raid Truck left ${who}'s base — drained ◈${drained}`,
              npcId: n.id,
              targetName: who,
              drained,
            });
          }
        }
        n.updatedAt = now;
      }
    }
  }

  // --- Dispatch new truck if due ---
  const hq = findCdaHq(npcs);
  const activeTruck = npcs.some(
    (n) => n.kind === "cda_truck" && n.phase !== "gone"
  );
  if (hq && !activeTruck) {
    const last = hq.lastDrainAt ?? hq.createdAt;
    // Ignore absurd future lastDrainAt so auto-dispatch isn't blocked forever
    const lastDispatch = last > now + CDA_TRUCK_MIN_GAP_MS ? 0 : last;
    if (now - lastDispatch >= CDA_TRUCK_MIN_GAP_MS) {
      const overdue = now - lastDispatch >= CDA_TRUCK_MAX_GAP_MS;
      if (overdue || Math.random() < 0.22) {
        const victim = pickTruckVictim(Array.from(byId.values()));
        if (victim) {
          const truck = spawnTruck(hq, victim, now);
          npcs.push(truck);
          hq.lastDrainAt = now;
          hq.updatedAt = now;
          notifications.push({
            playerId: victim.id,
            kind: "cda_dispatch",
            message: `CDA Raid Truck en route to ${victim.name}'s base`,
            npcId: truck.id,
            targetName: victim.name,
          });
        }
      }
    }
  }

  // Drop gone
  npcs = npcs.filter((n) => n.phase !== "gone");

  const dirtyPlayers = Array.from(dirty)
    .map((id) => byId.get(id))
    .filter(Boolean) as Player[];

  return { npcs, dirtyPlayers, notifications };
}

export function plantSpySat(opts: {
  npcs: WorldNpc[];
  planter: Player;
  sectors: Sector[];
  players: Player[];
  lat: number;
  lng: number;
  now?: number;
}): { npcs: WorldNpc[]; planter: Player } | { error: string } {
  const now = opts.now ?? Date.now();
  const { planter, sectors, players, lat, lng } = opts;
  if (!planter.homeSectorId || !planter.house) {
    return { error: "Settle your base before planting a spy sat" };
  }
  if (planter.gold < SPY_SAT_COST) {
    return { error: `Need ◈${SPY_SAT_COST} gold for a spy satellite` };
  }
  const pos = { lat, lng };

  // Must land in some mapped sector that isn't yours
  const sector = sectors.find(
    (s) => s.ring.length >= 4 && pointInRing(pos, s.ring)
  );
  if (!sector) {
    return { error: "Plant the spy sat inside an enemy sector" };
  }
  if (sector.id === planter.homeSectorId) {
    return { error: "Can't plant a spy sat in your own sector" };
  }

  // Target = a settled player in that sector (prefer someone with a house)
  const targets = players.filter(
    (p) =>
      p.id !== planter.id &&
      p.homeSectorId === sector.id &&
      p.house &&
      !isAzadHomeId(p.homeSectorId)
  );
  if (targets.length === 0) {
    return { error: "No enemy base in that sector to spy on" };
  }
  // Prefer closest house to plant point
  targets.sort(
    (a, b) =>
      distMeters(pos, a.house!) - distMeters(pos, b.house!)
  );
  const target = targets[0]!;

  // Don't stack sats on same target from same planter
  const already = opts.npcs.some(
    (n) =>
      n.kind === "spy_sat" &&
      n.phase === "active" &&
      n.ownerPlayerId === planter.id &&
      n.targetPlayerId === target.id
  );
  if (already) {
    return { error: "You already have a spy sat on that settler" };
  }

  const sat: WorldNpc = {
    id: nid("spy"),
    kind: "spy_sat",
    lat,
    lng,
    phase: "active",
    label: "Spy Satellite",
    ownerPlayerId: planter.id,
    ownerName: planter.name,
    targetPlayerId: target.id,
    targetName: target.name,
    sectorId: sector.id,
    lastDrainAt: now,
    drainedTotal: 0,
    createdAt: now,
    updatedAt: now,
  };

  return {
    npcs: [...opts.npcs.filter((n) => n.phase !== "gone"), sat],
    planter: {
      ...planter,
      gold: planter.gold - SPY_SAT_COST,
      updatedAt: now,
    },
  };
}

export function destroySpySat(opts: {
  npcs: WorldNpc[];
  actor: Player;
  npcId: string;
  now?: number;
}): { npcs: WorldNpc[] } | { error: string } {
  const now = opts.now ?? Date.now();
  const sat = opts.npcs.find((n) => n.id === opts.npcId);
  if (!sat || sat.kind !== "spy_sat" || sat.phase !== "active") {
    return { error: "Spy sat not found" };
  }
  // Defender or anyone close enough can smash it; owner can recall
  const isOwner = sat.ownerPlayerId === opts.actor.id;
  const isTarget = sat.targetPlayerId === opts.actor.id;
  if (!isOwner && !isTarget) {
    return { error: "Only the target or planter can destroy this sat" };
  }
  if (opts.actor.house) {
    const d = distMeters(
      { lat: sat.lat, lng: sat.lng },
      opts.actor.house
    );
    // Target must be near their base / sat; owner can always recall
    if (isTarget && !isOwner && d > SPY_SAT_DESTROY_RANGE_M * 8) {
      // Allow destroy from anywhere in sector for defender — sat is on their land
    }
  }
  return {
    npcs: opts.npcs.map((n) =>
      n.id === sat.id
        ? { ...n, phase: "gone" as const, updatedAt: now }
        : n
    ),
  };
}

export function chaseRaidTruck(opts: {
  npcs: WorldNpc[];
  actor: Player;
  npcId: string;
  actorPos?: { lat: number; lng: number } | null;
  now?: number;
}): { npcs: WorldNpc[]; message: string } | { error: string } {
  const now = opts.now ?? Date.now();
  const truck = opts.npcs.find((n) => n.id === opts.npcId);
  if (!truck || truck.kind !== "cda_truck") {
    return { error: "Raid truck not found" };
  }
  if (truck.phase !== "parked" && truck.phase !== "traveling") {
    return { error: "That truck already left" };
  }
  // Prefer house / live GPS as chase origin
  const origin =
    opts.actorPos ??
    opts.actor.house ??
    (opts.actor.villagerPost
      ? opts.actor.villagerPost
      : null);
  if (!origin) return { error: "Get near the truck to chase it off" };
  const pos = worldNpcTravelPos(truck, now);
  if (distMeters(origin, pos) > CDA_CHASE_RANGE_M) {
    return { error: "Move closer to the raid truck to chase it off" };
  }
  const hq = findCdaHq(opts.npcs);
  if (!hq) {
    return {
      npcs: opts.npcs.map((n) =>
        n.id === truck.id
          ? { ...n, phase: "gone" as const, updatedAt: now }
          : n
      ),
      message: "Raid truck chased off!",
    };
  }
  const fleeing: WorldNpc = {
    ...truck,
    phase: "fleeing",
    lat: pos.lat,
    lng: pos.lng,
    fromLat: pos.lat,
    fromLng: pos.lng,
    toLat: hq.lat,
    toLng: hq.lng,
    departAt: now,
    arriveAt: now + Math.floor(CDA_TRUCK_TRAVEL_MS * 0.7),
    updatedAt: now,
  };
  return {
    npcs: opts.npcs.map((n) => (n.id === truck.id ? fleeing : n)),
    message: `CDA Raid Truck chased off — stole ◈${truck.drainedTotal || 0}`,
  };
}

/** Scaffold spawn for future roam NPCs (merchant, tax, etc.) */
export function spawnRoamNpcStub(
  kind: Exclude<WorldNpc["kind"], "cda_hq" | "cda_truck" | "spy_sat">,
  near: { lat: number; lng: number },
  sector?: Sector | null
): WorldNpc {
  const now = Date.now();
  const center = sector?.ring?.length
    ? ringCentroid(sector.ring)
    : near;
  const labels: Record<string, string> = {
    tax_collector: "Tax Collector",
    merchant: "Merchant Caravan",
    saboteur: "Saboteur",
    bounty_hunter: "Bounty Hunter",
    recruiter: "Recruiter",
    diplomat: "Diplomat Scout",
  };
  return {
    id: nid(kind),
    kind,
    lat: center.lat,
    lng: center.lng,
    phase: "traveling",
    label: labels[kind] || kind,
    fromLat: near.lat,
    fromLng: near.lng,
    toLat: center.lat,
    toLng: center.lng,
    departAt: now,
    arriveAt: now + 60_000,
    createdAt: now,
    updatedAt: now,
  };
}
