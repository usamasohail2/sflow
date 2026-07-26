import {
  BUILDING_CATALOG,
  catalogItem,
  isAzadHomeId,
  type BuildingType,
  type PublicPlayer,
  type ResourceSpot,
  type Sector,
  type SectorAnalytics,
  type SectorPlayerStat,
  type SectorStatsPoint,
} from "@/lib/gameTypes";

export function sectorPointFromPlayers(
  players: Pick<
    PublicPlayer,
    | "homeSectorId"
    | "totalFarmed"
    | "gold"
    | "villagers"
    | "buildings"
    | "rockets"
    | "house"
  >[],
  sectorId: string,
  spotCount: number,
  ts = Date.now()
): SectorStatsPoint {
  let settlers = 0;
  let farmed = 0;
  let gold = 0;
  let villagers = 0;
  let buildings = 0;
  let rockets = 0;
  for (const p of players) {
    if (p.homeSectorId !== sectorId) continue;
    settlers += 1;
    farmed += p.totalFarmed || 0;
    gold += Math.floor(p.gold || 0);
    villagers += p.villagers || 0;
    buildings += p.buildings?.length || 0;
    rockets += p.rockets || 0;
  }
  return {
    ts,
    settlers,
    farmed,
    gold,
    villagers,
    buildings,
    rockets,
    spots: spotCount,
  };
}

export function buildSectorAnalytics(
  sectors: Sector[],
  players: PublicPlayer[],
  spots: ResourceSpot[],
  historyBySector: Record<string, SectorStatsPoint[]> = {}
): SectorAnalytics[] {
  const rows: SectorAnalytics[] = [];
  for (const sector of sectors) {
    const settlers = players.filter((p) => p.homeSectorId === sector.id);
    const sectorSpots = spots.filter((s) => s.sectorId === sector.id);
    const easy = sectorSpots.filter((s) => s.kind === "easy");
    const claimable = sectorSpots.filter((s) => s.claimable);
    const buildingMix: Partial<Record<BuildingType, number>> = {};
    let farmed = 0;
    let gold = 0;
    let villagers = 0;
    let buildings = 0;
    let rockets = 0;
    let housesUp = 0;
    const playerStats: SectorPlayerStat[] = settlers
      .map((p) => {
        farmed += p.totalFarmed || 0;
        gold += Math.floor(p.gold || 0);
        villagers += p.villagers || 0;
        buildings += p.buildings?.length || 0;
        rockets += p.rockets || 0;
        if (p.house && (p.houseHp ?? 0) > 0) housesUp += 1;
        for (const b of p.buildings) {
          buildingMix[b.type] = (buildingMix[b.type] || 0) + 1;
        }
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          farmed: p.totalFarmed || 0,
          gold: Math.floor(p.gold || 0),
          villagers: p.villagers || 0,
          buildings: p.buildings?.length || 0,
          rockets: p.rockets || 0,
          houseHp: p.houseHp ?? 0,
          hasHouse: Boolean(p.house),
        };
      })
      .sort((a, b) => b.farmed - a.farmed);

    const history = [...(historyBySector[sector.id] ?? [])].sort(
      (a, b) => a.ts - b.ts
    );
    // Always append a live tip so charts include "now"
    const live = sectorPointFromPlayers(
      players,
      sector.id,
      sectorSpots.length
    );
    const last = history[history.length - 1];
    if (
      !last ||
      last.farmed !== live.farmed ||
      last.settlers !== live.settlers ||
      last.gold !== live.gold ||
      Date.now() - last.ts > 60_000
    ) {
      history.push(live);
    }

    rows.push({
      sectorId: sector.id,
      name: sector.name,
      settlers: settlers.length,
      farmed,
      gold,
      villagers,
      buildings,
      rockets,
      housesUp,
      spotsEasy: easy.length,
      spotsClaimable: claimable.length,
      baseYield: easy.reduce((n, s) => n + (s.yield || 0), 0),
      buildingMix,
      players: playerStats,
      history,
    });
  }
  return rows.sort((a, b) => b.farmed - a.farmed);
}

/** Mapped-sector analytics only (skip Azad private homes). */
export function mappedSectorAnalytics(
  sectors: Sector[],
  players: PublicPlayer[],
  spots: ResourceSpot[],
  historyBySector: Record<string, SectorStatsPoint[]> = {}
): SectorAnalytics[] {
  const mappedPlayers = players.filter(
    (p) => p.homeSectorId && !isAzadHomeId(p.homeSectorId)
  );
  return buildSectorAnalytics(sectors, mappedPlayers, spots, historyBySector);
}

export function buildingLabel(type: BuildingType): string {
  return catalogItem(type).name;
}

export const ALL_BUILDING_TYPES = BUILDING_CATALOG.map((b) => b.type);
