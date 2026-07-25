import {
  GATHER_TRIP_MS,
  buildingBonus,
  type Player,
  type ResourceSpot,
} from "@/lib/gameTypes";

/**
 * Accrue gold for settled players based on completed gather trips.
 * Easy spots always contribute; discovered hidden spots that are available
 * also contribute once per trip window, then refill.
 */
export function accrueGather(
  players: Record<string, Player>,
  spots: ResourceSpot[],
  now = Date.now()
): {
  players: Record<string, Player>;
  spots: ResourceSpot[];
  changed: boolean;
} {
  const nextPlayers: Record<string, Player> = { ...players };
  let nextSpots = [...spots];
  let changed = false;

  for (const [id, p] of Object.entries(players)) {
    if (!p.homeSectorId || p.villagers <= 0) continue;

    const last = p.lastGatherAt || p.createdAt;
    const elapsed = Math.max(0, now - last);
    const trips = Math.floor(elapsed / GATHER_TRIP_MS);
    if (trips <= 0) continue;

    const sectorSpots = nextSpots.filter((s) => s.sectorId === p.homeSectorId);
    const easyYield = sectorSpots
      .filter((s) => s.kind === "easy")
      .reduce((sum, s) => sum + s.yield, 0);

    const bonus = buildingBonus(p.buildings);
    // Per trip: villagers work easy nodes + building bonus
    const goldPerTrip = p.villagers * (Math.max(1, easyYield) + bonus);

    // Hidden caches that are discovered & available: one harvest per trip batch,
    // then mark depleted (applied once for the whole trips window for simplicity)
    let hiddenGain = 0;
    nextSpots = nextSpots.map((s) => {
      if (s.sectorId !== p.homeSectorId) return s;
      if (s.kind !== "hidden") return s;
      if (!p.discoveredSpotIds.includes(s.id)) return s;
      if (s.availableAt > now) return s;
      // One harvest when available, then refill — not once per skipped trip
      hiddenGain += s.yield;
      return {
        ...s,
        availableAt: now + (s.refillMs || 45_000),
      };
    });

    const gained = goldPerTrip * trips + hiddenGain;
    nextPlayers[id] = {
      ...p,
      gold: p.gold + gained,
      totalFarmed: (p.totalFarmed || 0) + gained,
      lastGatherAt: last + trips * GATHER_TRIP_MS,
      updatedAt: now,
    };
    changed = true;
  }

  return { players: nextPlayers, spots: nextSpots, changed };
}

/** Phase 0→1 within current gather trip (for walk animation). */
export function gatherPhase(player: Player, now = Date.now()): number {
  if (!player.homeSectorId) return 0;
  const last = player.lastGatherAt || player.createdAt;
  return ((now - last) % GATHER_TRIP_MS) / GATHER_TRIP_MS;
}
