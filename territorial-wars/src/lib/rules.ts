import type { Player, SectorEconomy } from "@/lib/gameTypes";
import { RESOURCE_TICK_MS } from "@/lib/gameTypes";

export function villagersInSector(
  players: Record<string, Player>,
  sectorId: string
): number {
  let n = 0;
  for (const p of Object.values(players)) {
    if (p.activeSectorId === sectorId) n += p.villagers;
  }
  return n;
}

export function controllerOfSector(
  players: Record<string, Player>,
  sectorId: string
): string | null {
  let bestId: string | null = null;
  let best = 0;
  const tallies: Record<string, number> = {};
  for (const p of Object.values(players)) {
    if (p.activeSectorId !== sectorId) continue;
    tallies[p.id] = (tallies[p.id] ?? 0) + p.villagers;
  }
  for (const [id, n] of Object.entries(tallies)) {
    if (n > best) {
      best = n;
      bestId = id;
    } else if (n === best) {
      bestId = null; // contested
    }
  }
  return bestId;
}

/**
 * Accrue personal gold for stationed players and update sector dig totals.
 * Controllers get +1 bonus gold per tick.
 */
export function accrueGame(
  economies: Record<string, SectorEconomy>,
  players: Record<string, Player>,
  now = Date.now()
): { economies: Record<string, SectorEconomy>; players: Record<string, Player> } {
  const nextPlayers: Record<string, Player> = { ...players };
  const nextEco: Record<string, SectorEconomy> = { ...economies };

  // Group by sector for controller calc
  const sectorIds = new Set<string>();
  for (const p of Object.values(players)) {
    if (p.activeSectorId) sectorIds.add(p.activeSectorId);
  }

  for (const sectorId of Array.from(sectorIds)) {
    const eco =
      nextEco[sectorId] ??
      ({
        sectorId,
        dugTotal: 0,
        lastTickAt: now,
        controllerId: null,
      } satisfies SectorEconomy);

    const elapsed = Math.max(0, now - eco.lastTickAt);
    const ticks = Math.floor(elapsed / RESOURCE_TICK_MS);
    const controllerId = controllerOfSector(players, sectorId);

    if (ticks > 0) {
      let dug = 0;
      for (const p of Object.values(players)) {
        if (p.activeSectorId !== sectorId || p.villagers <= 0) continue;
        const perTick =
          p.villagers +
          p.digBonus +
          (controllerId === p.id ? 1 : 0);
        const gain = ticks * perTick;
        dug += gain;
        const cur = nextPlayers[p.id]!;
        nextPlayers[p.id] = {
          ...cur,
          gold: cur.gold + gain,
          updatedAt: now,
        };
      }
      nextEco[sectorId] = {
        ...eco,
        dugTotal: eco.dugTotal + dug,
        lastTickAt: eco.lastTickAt + ticks * RESOURCE_TICK_MS,
        controllerId,
      };
    } else {
      nextEco[sectorId] = { ...eco, controllerId };
    }
  }

  return { economies: nextEco, players: nextPlayers };
}

export function maxVillagersAllowed(player: Player): number {
  // One starter can camp; each house shelters one more
  return player.housesPlaced + 1;
}
