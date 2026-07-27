"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  GameMap,
  type ImpactAnim,
  type MarchAnim,
  type Placing,
} from "@/components/GameMap";
import { EntryGate } from "@/components/EntryGate";
import { HealthPanel } from "@/components/HealthPanel";
import { PublicChat } from "@/components/PublicChat";
import { SectorAnalyticsModal } from "@/components/SectorAnalytics";
import {
  Walkthrough,
  readWalkthroughDone,
} from "@/components/Walkthrough";
import {
  healthDotClass,
  healthLabel,
  levelFromIssues,
  type ClientHealth,
  type ServerHealth,
} from "@/lib/health";
import { mappedSectorAnalytics } from "@/lib/sectorAnalytics";
import { useMapPresence } from "@/hooks/useMapPresence";
import type { LatLng } from "@/lib/gameTypes";
import {
  INVITE_VILLAGER_BONUS,
  REVIEW_VILLAGER_BONUS,
  colorForPlayerId,
} from "@/lib/gameTypes";
import {
  googleMapsReviewUrl,
  type MapBusiness,
} from "@/lib/businesses";
import {
  BarracksSprite,
  CivicSprite,
  GoldCoinIcon,
  HouseSprite,
  LandCruiserSprite,
  MillSprite,
  PradoSprite,
  RocketSprite,
  ShovelSprite,
  SiloSprite,
  TroopSprite,
  VillagerSprite,
  WallsSprite,
  WarehouseSprite,
  WellSprite,
  SpySatSprite,
  CdaHqSprite,
  CdaTruckSprite,
} from "@/components/sprites";
import { ResourceGem } from "@/components/ResourceGem";
import type {
  BattleReport,
  Building,
  BuildingType,
  GameEvent,
  GameSnapshot,
  GemClaimEvent,
  Player,
  RazeEvent,
} from "@/lib/gameTypes";
import {
  AZAD_ARENA_NAME,
  AZAD_PENDING_ID,
  BUILDING_MAX_LEVEL,
  GEM_META,
  GOLD_COIN,
  ROCKET_COST,
  TROOP_COST,
  TROOP_DAMAGE,
  BASE_WALL_COST,
  FORTIFIED_HOUSE_MAX_HP,
  BASE_FORTIFIED_DEFENSE,
  houseMaxHp,
  attackPower,
  buildingBonus,
  buildingLevel,
  buildingTripBonus,
  buildingUpgradeCost,
  catalogItem,
  defenseBreakdown,
  defensePower,
  formatGold,
  formatGoldCompact,
  hasBarracks,
  hasRocketSilo,
  isAttackEvent,
  isAzadHomeId,
  isCdaRaidEvent,
  isGemClaimEvent,
  isRazeEvent,
  makeAzadPlacementSector,
  canUnlockFlexVehicles,
  sectorBaseCode,
  shovelDigYield,
} from "@/lib/gameTypes";
import { pointInOrNearRing, pointInRing } from "@/lib/geo";
import { ringCentroid } from "@/lib/mapMath";
import { timeAgo } from "@/lib/timeAgo";
import { SPY_SAT_COST, type WorldNpc } from "@/lib/worldNpcs";
import {
  buildingPlacementError,
  housePlacementError,
  isOccupiedGroundError,
} from "@/lib/placement";
import {
  isMusicOn,
  installUiSounds,
  playAttackSound,
  playBuildSound,
  playCoinSound,
  playErrorSound,
  playExplosionSound,
  playGemSpawnSound,
  playModalCloseSound,
  playModalOpenSound,
  playNotifySound,
  playNpcEngageSound,
  playNpcThreatSound,
  playRecruitSound,
  playRocketLaunchSound,
  playUnderAttackSound,
  readMusicPref,
  startMusic,
  syncPanelOpenSfx,
  toggleMusic,
  unlockAudio,
} from "@/lib/sound";

const BATTLE_ACK_KEY = "itw_battle_ack_ts";
const INVITE_KEY = "itw_invite";

function readBattleAck(): number {
  try {
    return Number(window.localStorage.getItem(BATTLE_ACK_KEY) || "0") || 0;
  } catch {
    return 0;
  }
}

function writeBattleAck(ts: number) {
  try {
    window.localStorage.setItem(BATTLE_ACK_KEY, String(ts));
  } catch {
    /* ignore */
  }
}

/** Persist ?invite= so it survives Google OAuth redirect */
function captureInviteFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const fromUrl = new URLSearchParams(window.location.search)
      .get("invite")
      ?.trim()
      .toUpperCase();
    if (fromUrl) {
      window.localStorage.setItem(INVITE_KEY, fromUrl);
      return fromUrl;
    }
  } catch {
    /* ignore */
  }
  return readStoredInvite();
}

function readStoredInvite(): string | null {
  try {
    return window.localStorage.getItem(INVITE_KEY);
  } catch {
    return null;
  }
}

function inviteCallbackUrl(): string {
  const code = captureInviteFromUrl();
  return code ? `/play?invite=${encodeURIComponent(code)}` : "/play";
}

type BattleSummary = {
  id: string;
  role: "attacker" | "defender";
  headline: string;
  /** One-line outcome under the headline — destroyed vs attacked */
  detail: string;
  sectorName: string;
  opponent: string;
  win: boolean;
  attackPower: number;
  defensePower: number;
  damage: number;
  destroyedCount: number;
  damagedCount: number;
  houseDestroyed: boolean;
  houseDamaged: boolean;
  rocketsLost: number;
  defenderRocketsLost: number;
  lootedGold: number;
};

function BuildingThumb({
  type,
  className = "",
}: {
  type: BuildingType;
  className?: string;
}) {
  if (type === "mill") return <MillSprite className={className} />;
  if (type === "warehouse") return <WarehouseSprite className={className} />;
  if (type === "shovel") return <ShovelSprite className={className} />;
  if (type === "barracks") return <BarracksSprite className={className} />;
  if (type === "silo") return <SiloSprite className={className} />;
  if (type === "civic") return <CivicSprite className={className} />;
  if (type === "prado") return <PradoSprite className={className} />;
  if (type === "landcruiser") return <LandCruiserSprite className={className} />;
  return <WellSprite className={className} />;
}

const SHOVEL_INTRO_KEY = "itw_shovel_intro_v1";

function readShovelIntroDone(): boolean {
  try {
    return window.localStorage.getItem(SHOVEL_INTRO_KEY) === "1";
  } catch {
    return false;
  }
}

function markShovelIntroDone(): void {
  try {
    window.localStorage.setItem(SHOVEL_INTRO_KEY, "1");
  } catch {
    /* ignore */
  }
}

function destroyedCountFrom(destroyed: string | null): number {
  if (!destroyed) return 0;
  return destroyed.split(",").map((s) => s.trim()).filter(Boolean).length;
}

function personName(name: string): string {
  const t = name.trim();
  if (!t) return "Someone";
  return t;
}

function pickVariant<T>(seed: string, options: readonly T[]): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return options[h % options.length]!;
}

function playerColor(
  id: string,
  colors?: Map<string, string> | Record<string, string> | null
): string {
  if (colors instanceof Map) {
    return colors.get(id) || colorForPlayerId(id);
  }
  if (colors && colors[id]) return colors[id]!;
  return colorForPlayerId(id);
}

function NameChip({
  id,
  name,
  myId,
  colors,
  possessive = false,
  ally = false,
}: {
  id: string;
  name: string;
  myId?: string | null;
  colors?: Map<string, string> | Record<string, string> | null;
  possessive?: boolean;
  /** Same-sector ally marker — e.g. Usama (ally) */
  ally?: boolean;
}) {
  const isYou = Boolean(myId && id === myId);
  const color = playerColor(id, colors);
  if (isYou && possessive) {
    return (
      <span className="font-bold" style={{ color }}>
        Your
      </span>
    );
  }
  const label = isYou ? "You" : personName(name);
  return (
    <span className="font-bold" style={{ color }}>
      {possessive ? `${label}'s` : label}
      {ally && !isYou ? (
        <span className="font-mono text-[9px] font-normal tracking-normal text-[var(--field-bright)]">
          {" "}
          (ally)
        </span>
      ) : null}
    </span>
  );
}

type ActivityColors = Map<string, string> | Record<string, string> | null;

function attackerOutcomeCopy(battle: BattleReport, defenderName: string): {
  headline: string;
  detail: string;
} {
  const name = personName(defenderName);
  const wiped = destroyedCountFrom(battle.destroyed);
  const parts: string[] = [];
  if (battle.destroyed) parts.push(battle.destroyed);
  if (battle.houseDestroyed) parts.push("Base");
  const destroyedList = parts.join(", ");

  if (!battle.win) {
    return {
      headline: "Attack failed",
      detail: `${name}'s defenses held — no buildings destroyed`,
    };
  }
  if (wiped > 0 || battle.houseDestroyed) {
    return {
      headline: "Destroyed",
      detail: `You destroyed ${destroyedList} at ${name}'s village`,
    };
  }
  if (battle.damage > 0 || battle.damagedBuildings.length > 0 || battle.houseDamaged) {
    const hit =
      battle.damagedBuildings.length > 0
        ? battle.damagedBuildings.join(", ")
        : battle.houseDamaged
          ? "their base"
          : "their village";
    return {
      headline: "Attacked",
      detail: `You attacked ${hit} (${battle.damage} dmg) — still standing`,
    };
  }
  return {
    headline: "Attacked",
    detail: `You attacked ${name}'s village — no buildings destroyed`,
  };
}

function defenderOutcomeCopy(battle: BattleReport, attackerName: string): {
  headline: string;
  detail: string;
} {
  const name = personName(attackerName);
  const parts: string[] = [];
  if (battle.destroyed) parts.push(battle.destroyed);
  if (battle.houseDestroyed) parts.push("Base");
  const destroyedList = parts.join(", ");

  if (!battle.win) {
    return {
      headline: "Defense held",
      detail: `You stopped ${name}'s attack — nothing destroyed`,
    };
  }
  if (destroyedCountFrom(battle.destroyed) > 0 || battle.houseDestroyed) {
    return {
      headline: "Destroyed",
      detail: `${name} destroyed your ${destroyedList}`,
    };
  }
  return {
    headline: "Attacked",
    detail: `${name} attacked your village (${battle.damage} dmg) — still standing`,
  };
}

function summaryFromAttack(
  battle: BattleReport,
  sectorName: string,
  defenderName: string,
  id = `atk_${Date.now()}`
): BattleSummary {
  const outcome = attackerOutcomeCopy(battle, defenderName);
  return {
    id,
    role: "attacker",
    headline: outcome.headline,
    detail: outcome.detail,
    sectorName,
    opponent: personName(defenderName),
    win: battle.win,
    attackPower: battle.attackPower,
    defensePower: battle.defensePower,
    damage: battle.damage,
    destroyedCount: destroyedCountFrom(battle.destroyed),
    damagedCount: battle.damagedBuildings.length,
    houseDestroyed: battle.houseDestroyed,
    houseDamaged: battle.houseDamaged,
    rocketsLost: battle.rocketsLost,
    defenderRocketsLost: battle.defenderRocketsLost,
    lootedGold: battle.lootedGold,
  };
}

function summaryFromEvent(e: GameEvent, asDefender = true): BattleSummary | null {
  if (!isAttackEvent(e)) return null;
  const rocketsLost =
    e.rocketsLost ?? (e.soldiersLost || 0) + (e.tanksLost || 0);
  const defenderRocketsLost =
    e.defenderRocketsLost ?? e.defenderSoldiersLost ?? 0;
  const report: BattleReport = {
    win: e.win,
    attackPower: e.attackPower ?? 0,
    defensePower: e.defensePower ?? 0,
    damage: e.damage,
    destroyed: e.destroyed,
    damagedBuildings: e.damagedBuildings ?? [],
    houseDestroyed: Boolean(e.houseDestroyed),
    houseDamaged: Boolean(e.houseDamaged),
    lootedGold: e.lootedGold,
    rocketsLost,
    defenderRocketsLost,
  };

  if (!asDefender) {
    return summaryFromAttack(report, e.sectorName, e.defenderName, e.id);
  }

  const outcome = defenderOutcomeCopy(report, e.attackerName);
  return {
    id: e.id,
    role: "defender",
    headline: outcome.headline,
    detail: outcome.detail,
    sectorName: e.sectorName,
    opponent: personName(e.attackerName),
    win: !e.win,
    attackPower: report.attackPower,
    defensePower: report.defensePower,
    damage: report.damage,
    destroyedCount: destroyedCountFrom(report.destroyed),
    damagedCount: report.damagedBuildings.length,
    houseDestroyed: report.houseDestroyed,
    houseDamaged: report.houseDamaged,
    rocketsLost: report.rocketsLost,
    defenderRocketsLost: report.defenderRocketsLost,
    lootedGold: report.lootedGold,
  };
}

const ATTACK_WIN_VERBS = ["attacked", "breached", "wrecked", "smashed"] as const;
const ATTACK_HOLD_VERBS = ["held off", "stopped", "repelled"] as const;

function eventLogLine(
  e: GameEvent,
  myId: string | undefined,
  colors?: ActivityColors
): ReactNode {
  if (isRazeEvent(e)) {
    const wiped = e.destroyed !== false;
    const verb = wiped ? "destroyed" : "attacked";
    const iAmTarget = Boolean(myId && e.defenderId === myId && e.attackerId !== myId);
    if (e.attackerId === myId) {
      return (
        <>
          <NameChip id={e.attackerId} name={e.attackerName} myId={myId} colors={colors} />{" "}
          {verb}{" "}
          <NameChip
            id={e.defenderId}
            name={e.defenderName}
            myId={myId}
            colors={colors}
            possessive
          />{" "}
          {e.buildingName}
          {e.rocketsLost
            ? ` (${e.rocketsLost} rocket${e.rocketsLost === 1 ? "" : "s"})`
            : ""}{" "}
          in {e.sectorName}
        </>
      );
    }
    return (
      <>
        <NameChip
          id={e.attackerId}
          name={e.attackerName}
          myId={myId}
          colors={colors}
          ally={iAmTarget}
        />{" "}
        {verb}{" "}
        <NameChip
          id={e.defenderId}
          name={e.defenderName}
          myId={myId}
          colors={colors}
          possessive
        />{" "}
        {e.buildingName}
      </>
    );
  }
  if (!isAttackEvent(e)) return "Activity";
  const asAttacker = e.attackerId === myId;
  if (asAttacker) {
    if (e.win) {
      const verb = pickVariant(e.id, ATTACK_WIN_VERBS);
      return (
        <>
          <NameChip id={e.attackerId} name={e.attackerName} myId={myId} colors={colors} />{" "}
          {verb}{" "}
          <NameChip
            id={e.defenderId}
            name={e.defenderName}
            myId={myId}
            colors={colors}
            possessive
          />{" "}
          village in {e.sectorName}
        </>
      );
    }
    const hold = pickVariant(e.id, ATTACK_HOLD_VERBS);
    return (
      <>
        <NameChip id={e.defenderId} name={e.defenderName} myId={myId} colors={colors} />{" "}
        {hold}{" "}
        <NameChip
          id={e.attackerId}
          name={e.attackerName}
          myId={myId}
          colors={colors}
          possessive
        />{" "}
        raid in {e.sectorName}
      </>
    );
  }
  if (e.win) {
    const verb = pickVariant(e.id, ATTACK_WIN_VERBS);
    return (
      <>
        <NameChip id={e.attackerId} name={e.attackerName} myId={myId} colors={colors} />{" "}
        {verb}{" "}
        <NameChip
          id={e.defenderId}
          name={e.defenderName}
          myId={myId}
          colors={colors}
          possessive
        />{" "}
        village in {e.sectorName}
      </>
    );
  }
  const hold = pickVariant(e.id, ATTACK_HOLD_VERBS);
  return (
    <>
      <NameChip id={e.defenderId} name={e.defenderName} myId={myId} colors={colors} />{" "}
      {hold}{" "}
      <NameChip
        id={e.attackerId}
        name={e.attackerName}
        myId={myId}
        colors={colors}
        possessive
      />{" "}
      raid in {e.sectorName}
    </>
  );
}

function activityLine(
  e: GameEvent,
  myId?: string | null,
  colors?: ActivityColors
): ReactNode {
  if (isRazeEvent(e)) {
    const wiped = e.destroyed !== false;
    const verb = wiped ? "destroyed" : "attacked";
    const iAmTarget = Boolean(myId && e.defenderId === myId && e.attackerId !== myId);
    return (
      <>
        <NameChip
          id={e.attackerId}
          name={e.attackerName}
          myId={myId}
          colors={colors}
          ally={iAmTarget}
        />{" "}
        {verb}{" "}
        <NameChip
          id={e.defenderId}
          name={e.defenderName}
          myId={myId}
          colors={colors}
          possessive
        />{" "}
        {e.buildingName}
        {!iAmTarget ? ` · ${e.sectorName}` : ""}
      </>
    );
  }
  if (isGemClaimEvent(e)) {
    const gemLabel = GEM_META[e.gem]?.label ?? "gem";
    return (
      <>
        <NameChip id={e.attackerId} name={e.attackerName} myId={myId} colors={colors} />{" "}
        claimed{" "}
        <NameChip
          id={e.defenderId}
          name={e.defenderName}
          myId={myId}
          colors={colors}
          possessive
        />{" "}
        {gemLabel} · {e.claimerSectorName}
      </>
    );
  }
  if (isCdaRaidEvent(e)) {
    const who = e.defenderName || "a settler";
    if (e.stage === "dispatch") {
      return (
        <>
          <span className="font-semibold text-[var(--sand)]">CDA</span> raid truck
          en route to{" "}
          <NameChip id={e.defenderId} name={who} myId={myId} colors={colors} /> ·{" "}
          {e.sectorName}
        </>
      );
    }
    if (e.stage === "arrive") {
      return (
        <>
          <span className="font-semibold text-[var(--sand)]">CDA</span> parked at{" "}
          <NameChip
            id={e.defenderId}
            name={who}
            myId={myId}
            colors={colors}
            possessive
          />{" "}
          base · {e.sectorName}
        </>
      );
    }
    if (e.stage === "chase") {
      return (
        <>
          <NameChip id={e.attackerId} name={e.attackerName} myId={myId} colors={colors} />{" "}
          chased CDA off{" "}
          <NameChip
            id={e.defenderId}
            name={who}
            myId={myId}
            colors={colors}
            possessive
          />{" "}
          base
          {e.drained ? ` · ◈${e.drained} taken` : ""}
        </>
      );
    }
    return (
      <>
        <span className="font-semibold text-[var(--sand)]">CDA</span> left{" "}
        <NameChip
          id={e.defenderId}
          name={who}
          myId={myId}
          colors={colors}
          possessive
        />{" "}
        base
        {e.drained != null ? ` — drained ◈${e.drained}` : ""} · {e.sectorName}
      </>
    );
  }
  if (isAttackEvent(e)) {
    if (e.win) {
      const verb = pickVariant(e.id, ATTACK_WIN_VERBS);
      return (
        <>
          <NameChip id={e.attackerId} name={e.attackerName} myId={myId} colors={colors} />{" "}
          {verb}{" "}
          <NameChip id={e.defenderId} name={e.defenderName} myId={myId} colors={colors} /> ·{" "}
          {e.sectorName}
        </>
      );
    }
    const hold = pickVariant(e.id, ATTACK_HOLD_VERBS);
    return (
      <>
        <NameChip id={e.defenderId} name={e.defenderName} myId={myId} colors={colors} />{" "}
        {hold}{" "}
        <NameChip id={e.attackerId} name={e.attackerName} myId={myId} colors={colors} /> ·{" "}
        {e.sectorName}
      </>
    );
  }
  return "Activity";
}

/** Compact CS-style killfeed line — verb first so outcome is obvious */
function killFeedLine(
  e: GameEvent,
  myId?: string | null,
  colors?: ActivityColors
): ReactNode {
  if (isRazeEvent(e)) {
    const wiped = e.destroyed !== false;
    const iAmTarget = Boolean(myId && e.defenderId === myId && e.attackerId !== myId);
    return (
      <>
        <NameChip
          id={e.attackerId}
          name={e.attackerName}
          myId={myId}
          colors={colors}
          ally={iAmTarget}
        />
        <span className={`kill-feed-verb ${wiped ? "is-destroy" : "is-attack"}`}>
          {wiped ? "destroyed" : "attacked"}
        </span>
        <NameChip
          id={e.defenderId}
          name={e.defenderName}
          myId={myId}
          colors={colors}
          possessive
        />{" "}
        {e.buildingName}
      </>
    );
  }
  if (isGemClaimEvent(e)) {
    const gemLabel = GEM_META[e.gem]?.label ?? "gem";
    return (
      <>
        <NameChip id={e.attackerId} name={e.attackerName} myId={myId} colors={colors} />
        <span className="kill-feed-verb is-claim">stole</span>
        <NameChip
          id={e.defenderId}
          name={e.defenderName}
          myId={myId}
          colors={colors}
          possessive
        />{" "}
        {gemLabel}
      </>
    );
  }
  if (isCdaRaidEvent(e)) {
    const who = e.defenderName || "Settler";
    if (e.stage === "dispatch") {
      return (
        <>
          <span className="font-semibold text-[var(--sand)]">CDA</span>
          <span className="kill-feed-verb is-attack">raiding</span>
          <NameChip id={e.defenderId} name={who} myId={myId} colors={colors} />
          <span className="kill-feed-sector">{e.sectorName}</span>
        </>
      );
    }
    if (e.stage === "arrive") {
      return (
        <>
          <span className="font-semibold text-[var(--sand)]">CDA</span>
          <span className="kill-feed-verb is-attack">parked at</span>
          <NameChip id={e.defenderId} name={who} myId={myId} colors={colors} />
          <span className="kill-feed-sector">{e.sectorName}</span>
        </>
      );
    }
    if (e.stage === "chase") {
      return (
        <>
          <NameChip id={e.attackerId} name={e.attackerName} myId={myId} colors={colors} />
          <span className="kill-feed-verb is-hold">chased off</span>
          <span className="font-semibold text-[var(--sand)]">CDA</span>
          <span className="kill-feed-sector">
            {who}
            {e.drained ? ` · ◈${e.drained}` : ""}
          </span>
        </>
      );
    }
    return (
      <>
        <span className="font-semibold text-[var(--sand)]">CDA</span>
        <span className="kill-feed-verb is-destroy">drained</span>
        <NameChip id={e.defenderId} name={who} myId={myId} colors={colors} />
        <span className="kill-feed-sector">
          {e.drained != null ? `◈${e.drained}` : e.sectorName}
        </span>
      </>
    );
  }
  if (isAttackEvent(e)) {
    const wiped =
      e.win &&
      (Boolean(e.destroyed) ||
        Boolean(e.houseDestroyed) ||
        destroyedCountFrom(e.destroyed) > 0);
    return (
      <>
        <NameChip id={e.attackerId} name={e.attackerName} myId={myId} colors={colors} />
        <span
          className={`kill-feed-verb ${
            !e.win ? "is-hold" : wiped ? "is-destroy" : "is-attack"
          }`}
        >
          {!e.win ? "failed vs" : wiped ? "destroyed" : "attacked"}
        </span>
        <NameChip id={e.defenderId} name={e.defenderName} myId={myId} colors={colors} />
        <span className="kill-feed-sector">{e.sectorName}</span>
      </>
    );
  }
  return "Activity";
}

const KILL_FEED_MAX = 4;
const KILL_FEED_TTL_MS = 8_000;
const KILL_FEED_FADE_MS = 1_800;

type KillFeedItem = { id: string; event: GameEvent; shownAt: number };

/** Dock overlay: hammer strikes while a buy/build syncs */
function CameoBuildLoader() {
  return (
    <span className="cameo-dock-loader" aria-hidden>
      <span className="cameo-hammer">
        <svg viewBox="0 0 24 24" aria-hidden>
          <rect x="11.2" y="8" width="2.2" height="13" rx="1" fill="#8b5a2b" />
          <rect
            x="11.5"
            y="9"
            width="0.7"
            height="10"
            rx="0.3"
            fill="#c4a06a"
            opacity="0.45"
          />
          <rect x="6.5" y="4.2" width="11" height="5.2" rx="1.2" fill="#9aa3a0" />
          <rect x="6.5" y="4.2" width="11" height="2" rx="1" fill="#c5ccc8" />
          <rect x="7.4" y="5.2" width="2.4" height="3.2" rx="0.4" fill="#6a726c" />
          <rect x="14.2" y="5.2" width="2.4" height="3.2" rx="0.4" fill="#6a726c" />
        </svg>
        <span className="cameo-hammer-spark" />
      </span>
      <span className="cameo-dock-progress" />
    </span>
  );
}

export function PlayShell() {
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(
    null
  );
  const [razeTarget, setRazeTarget] = useState<{
    playerId: string;
    buildingId: string;
  } | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const [activityTab, setActivityTab] = useState<"global" | "you">("global");
  const [razeAlert, setRazeAlert] = useState<RazeEvent | null>(null);
  const [gemClaimAlert, setGemClaimAlert] = useState<GemClaimEvent | null>(
    null
  );
  /** Rockets to fire in the next salvo */
  const [salvo, setSalvo] = useState(1);
  const [busy, setBusy] = useState(false);
  /** Shown while a settle/rebuild/build write is in flight */
  const [savingLabel, setSavingLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [displayGold, setDisplayGold] = useState(0);
  const [showMissions, setShowMissions] = useState(false);
  const [showRanks, setShowRanks] = useState(false);
  const [showSectorRename, setShowSectorRename] = useState(false);
  const [sectorTagDraft, setSectorTagDraft] = useState("");
  const [sectorRenameSaving, setSectorRenameSaving] = useState(false);
  const wasSectorTop = useRef(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [analyticsSectorId, setAnalyticsSectorId] = useState<string | null>(
    null
  );
  const [showHealth, setShowHealth] = useState(false);
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null);
  const [serverHealthLoading, setServerHealthLoading] = useState(false);
  const [clientHealthRaw, setClientHealthRaw] = useState({
    lastOkAt: null as number | null,
    lastAttemptAt: null as number | null,
    lastLatencyMs: null as number | null,
    failStreak: 0,
    lastError: null as string | null,
    clockSkewMs: null as number | null,
    online: true,
  });
  const [showMenu, setShowMenu] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showBattles, setShowBattles] = useState(false);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [placing, setPlacing] = useState<Placing | null>(null);
  /** Buildings currently syncing to the server (optimistic place) */
  const [syncingBuilds, setSyncingBuilds] = useState<
    Array<{ id: string; type: BuildingType }>
  >([]);
  const syncingBuildIds = syncingBuilds.map((b) => b.id);
  const syncingBuildTypes = new Set(syncingBuilds.map((b) => b.type));
  const syncingBuildIdsRef = useRef<string[]>([]);
  syncingBuildIdsRef.current = syncingBuildIds;
  /** Rocket stock purchase in flight — dock tile shows a loader */
  const [buyingRocket, setBuyingRocket] = useState(false);
  /** Barracks troop recruit in flight */
  const [buyingTroop, setBuyingTroop] = useState(false);
  /** Fortress walls purchase in flight */
  const [buyingWalls, setBuyingWalls] = useState(false);
  /** free-place mode: admin CDA HQ or spy sat plant */
  const [npcPlacing, setNpcPlacing] = useState<null | "cda_hq" | "spy_sat">(
    null
  );
  const [plantingSat, setPlantingSat] = useState(false);
  /** Gem/resource spot ids currently claiming on the server */
  const [claimingSpotIds, setClaimingSpotIds] = useState<string[]>([]);
  const claimingSpotIdsRef = useRef<string[]>([]);
  const [pendingHouse, setPendingHouse] = useState<LatLng | null>(null);
  /** Sector chosen for settle — tiles drive house → villager placement */
  const [settleSector, setSettleSector] = useState<Placing["sector"] | null>(
    null
  );
  const [march, setMarch] = useState<MarchAnim | null>(null);
  const [impact, setImpact] = useState<ImpactAnim | null>(null);
  const [battleSummary, setBattleSummary] = useState<BattleSummary | null>(
    null
  );
  /** Live location pin shown on the map while picking a sector */
  const [liveLocation, setLiveLocation] = useState<LatLng | null>(null);
  /** Locked pin for settle (mapped sector id or Azad pending) */
  const [gpsFix, setGpsFix] = useState<{
    sectorId: string;
    lat: number;
    lng: number;
  } | null>(null);
  /** Player is settling in Azad Umeed Wars (no sector walls) */
  const [azadMode, setAzadMode] = useState(false);
  /** idle → reading → ok | failed (denied / timeout / unsupported) */
  const [locStatus, setLocStatus] = useState<
    "idle" | "reading" | "ok" | "failed"
  >("idle");
  /** Manual path: pick sector from list or place/drag pin on map */
  const [manualMode, setManualMode] = useState(false);
  /** Awaiting first map tap to drop a pin (manual mode) */
  const [pickingPin, setPickingPin] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [locationFocus, setLocationFocus] = useState(0);
  /** Bump to re-fly the map when the same sector is picked again */
  const [sectorFocus, setSectorFocus] = useState(0);
  /** Bump to fly the camera back to the player's house */
  const [homeFocus, setHomeFocus] = useState(0);
  const [reviewBiz, setReviewBiz] = useState<MapBusiness | null>(null);
  const [reviewOpenedAt, setReviewOpenedAt] = useState<number | null>(null);
  const [reviewReady, setReviewReady] = useState(false);
  /** Own clicker shovel currently open */
  const [shovelId, setShovelId] = useState<string | null>(null);
  const shovelIdRef = useRef<string | null>(null);
  shovelIdRef.current = shovelId;
  /** Own building selected for upgrade / demolish */
  const [manageBuildingId, setManageBuildingId] = useState<string | null>(null);
  const [showShovelIntro, setShowShovelIntro] = useState(false);
  const [shovelDigging, setShovelDigging] = useState(false);
  const [shovelFloats, setShovelFloats] = useState<
    { id: number; x: number; amount: number }[]
  >([]);
  const shovelFloatSeq = useRef(0);
  const [musicOn, setMusicOn] = useState(false);
  const identityChecked = useRef(false);
  const seenEvents = useRef<Set<string>>(new Set());
  const eventsPrimed = useRef(false);
  const killFeedSeen = useRef<Set<string>>(new Set());
  const killFeedPrimed = useRef(false);
  /** Dedup NPC threat SFX across snapshot polls */
  const seenNpcThreats = useRef<Set<string>>(new Set());
  /** Last open state per HUD panel — drives open/close SFX */
  const panelSfx = useRef({
    menu: false,
    ranks: false,
    battles: false,
    missions: false,
    invite: false,
    analytics: false,
    health: false,
    walkthrough: false,
    activity: false,
    sectorRename: false,
    shovelIntro: false,
    shovel: false,
    manage: false,
    attack: false,
    raze: false,
    review: false,
    saving: false,
    npcPlace: false,
  });
  const [killFeed, setKillFeed] = useState<KillFeedItem[]>([]);
  const [killFeedNow, setKillFeedNow] = useState(() => Date.now());
  const [relativeNow, setRelativeNow] = useState(() => Date.now());
  const meIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const settleGuardUntil = useRef(0);
  const lastGoodMe = useRef<Player | null>(null);
  const sectorHistoryRef = useRef<GameSnapshot["sectorHistory"]>({});
  const lastActionErrorRef = useRef<string | null>(null);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const lastInviteCount = useRef<number | null>(null);
  const tipsArmed = useRef(false);
  /** Next map pin drop should force Azad (from “Play Azad instead”) */
  const pinDropAzad = useRef(false);

  const IDENT_KEY = "itw_player_id";

  const {
    visitorId,
    displayName,
    viewers: onlineViewers,
    peers: presencePeers,
    selfCamera,
    selfBubble,
    reportCamera,
    noteLocalMessage,
    rename: renamePresence,
  } = useMapPresence(true);

  useEffect(() => {
    captureInviteFromUrl();
  }, []);

  // Keep “3 mins ago” labels fresh while battle / activity panels are open
  useEffect(() => {
    if (!showBattles && !showActivity) return;
    setRelativeNow(Date.now());
    const id = window.setInterval(() => setRelativeNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [showBattles, showActivity]);

  const applySnap = useCallback((data: GameSnapshot) => {
    // Don't resurrect gems mid-claim if a poll races the write
    const claiming = new Set(claimingSpotIdsRef.current);
    const normalized: GameSnapshot = {
      ...data,
      sectorHistory: data.sectorHistory ?? {},
    };
    let next: GameSnapshot =
      claiming.size > 0
        ? {
            ...normalized,
            spots: normalized.spots.filter((s) => !claiming.has(s.id)),
          }
        : normalized;
    const prevMe = lastGoodMe.current;
    const incoming = next.me;
    // Guard against a stale poll wiping a just-saved settlement (~3s race).
    // Still accept the server building list so razes aren't masked by
    // optimistic digs bumping local updatedAt during the guard window.
    if (
      prevMe?.homeSectorId &&
      prevMe.house &&
      Date.now() < settleGuardUntil.current
    ) {
      if (
        !incoming ||
        !incoming.homeSectorId ||
        !incoming.house ||
        (incoming.updatedAt ?? 0) < (prevMe.updatedAt ?? 0)
      ) {
        const syncingIds = new Set(syncingBuildIdsRef.current);
        const buildings =
          incoming?.homeSectorId && incoming.house
            ? [
                ...incoming.buildings,
                ...prevMe.buildings.filter(
                  (b) =>
                    syncingIds.has(b.id) &&
                    !incoming.buildings.some((s) => s.id === b.id)
                ),
              ]
            : prevMe.buildings;
        const guardedMe: Player = { ...prevMe, buildings };
        next = {
          ...next,
          me: guardedMe,
          players: next.players.map((p) =>
            p.id === prevMe.id
              ? {
                  ...p,
                  homeSectorId: prevMe.homeSectorId,
                  house: prevMe.house,
                  houseHp: prevMe.houseHp,
                  villagerPost: prevMe.villagerPost,
                  villagers: prevMe.villagers,
                  gold: prevMe.gold,
                  buildings,
                }
              : p
          ),
        };
      }
    }

    if (next.me?.homeSectorId && next.me.house) {
      lastGoodMe.current = next.me;
    } else if (next.me && !next.me.homeSectorId) {
      // Only clear the guard cache once the server agrees we're unsettled
      // after the guard window
      if (Date.now() >= settleGuardUntil.current) {
        lastGoodMe.current = next.me;
      }
    }

    if (next.sectorHistory && Object.keys(next.sectorHistory).length > 0) {
      sectorHistoryRef.current = next.sectorHistory;
    }
    setSnap(next);
    if (next.me) setDisplayGold(next.me.gold);
    setSelectedId((cur) => {
      if (cur) return cur;
      const home = next.me?.homeSectorId;
      // Only auto-select a sector once settled — new players wait for location
      if (home && !isAzadHomeId(home)) return home;
      return null;
    });
    if (next.me?.homeSectorId && isAzadHomeId(next.me.homeSectorId)) {
      setAzadMode(true);
    }

    const nextId = next.me?.id ?? null;
    if (nextId !== meIdRef.current) {
      // New identity (first load or player switch) — don't replay history
      meIdRef.current = nextId;
      seenEvents.current = new Set();
      eventsPrimed.current = false;
      killFeedSeen.current = new Set();
      killFeedPrimed.current = false;
      setKillFeed([]);
      lastInviteCount.current = null;
    }

    // Toast when a referral lands (+1 villager)
    const ic = next.inviteCount ?? 0;
    if (lastInviteCount.current !== null && ic > lastInviteCount.current) {
      const gained = ic - lastInviteCount.current;
      setToast(
        gained === 1
          ? `Friend joined — +${INVITE_VILLAGER_BONUS} villager!`
          : `${gained} friends joined — +${gained * INVITE_VILLAGER_BONUS} villagers!`
      );
      window.setTimeout(() => setToast(null), 4200);
    }
    if (next.me) lastInviteCount.current = ic;

    const events = next.events ?? [];
    if (!eventsPrimed.current) {
      for (const e of events) seenEvents.current.add(e.id);
      eventsPrimed.current = true;
      // Unacknowledged hits on this account — stay until dismissed
      const ack = typeof window !== "undefined" ? readBattleAck() : 0;
      const pendingHit = [...events]
        .reverse()
        .find(
          (e) =>
            next.me &&
            e.defenderId === next.me.id &&
            e.ts > ack &&
            isAttackEvent(e)
        );
      if (pendingHit) {
        const summary = summaryFromEvent(pendingHit);
        if (summary) setBattleSummary(summary);
      }
      const pendingRaze = [...events]
        .reverse()
        .find(
          (e) =>
            next.me &&
            e.defenderId === next.me.id &&
            e.ts > ack &&
            isRazeEvent(e)
        );
      if (pendingRaze && isRazeEvent(pendingRaze)) {
        setRazeAlert(pendingRaze);
      }
      return;
    }
    for (const e of events) {
      if (seenEvents.current.has(e.id)) continue;
      seenEvents.current.add(e.id);
      if (!next.me || e.defenderId !== next.me.id) continue;

      if (isRazeEvent(e)) {
        playUnderAttackSound();
        const building = next.me.buildings.find((b) => b.id === e.buildingId);
        const at =
          building != null
            ? { lat: building.lat, lng: building.lng }
            : next.me.house;
        if (at) {
          setImpact({ at, startedAt: Date.now() });
          window.setTimeout(() => setImpact(null), 1600);
        }
        // If a ghost copy survived the settle-guard merge, strip a destroyed building
        if (e.destroyed && building) {
          const patchedMe: Player = {
            ...next.me,
            buildings: next.me.buildings.filter((b) => b.id !== e.buildingId),
            updatedAt: Math.max(next.me.updatedAt ?? 0, e.ts),
          };
          next = {
            ...next,
            me: patchedMe,
            players: next.players.map((p) =>
              p.id === patchedMe.id
                ? { ...p, buildings: patchedMe.buildings }
                : p
            ),
          };
          lastGoodMe.current = patchedMe;
        }
        if (
          e.destroyed &&
          shovelIdRef.current &&
          e.buildingId === shovelIdRef.current
        ) {
          setShovelId(null);
          setShowShovelIntro(false);
          setShovelDigging(false);
          setShovelFloats([]);
          setToast("Your shovel was destroyed");
          window.setTimeout(() => setToast(null), 3400);
        }
        window.setTimeout(() => {
          setRazeAlert(e);
          setShowBattles(false);
          setShowActivity(false);
        }, 400);
        continue;
      }

      if (isGemClaimEvent(e)) {
        setGemClaimAlert(e);
        continue;
      }

      if (isCdaRaidEvent(e)) {
        playNpcThreatSound();
        const msg =
          e.stage === "dispatch"
            ? `CDA Raid Truck en route to your base`
            : e.stage === "arrive"
              ? `CDA Raid Truck parked at your base — chase it off!`
              : e.stage === "chase"
                ? e.attackerId === next.me.id
                  ? `You chased off the CDA truck`
                  : `${e.attackerName} chased CDA off your base`
                : `CDA left your base${
                    e.drained != null ? ` — drained ◈${e.drained}` : ""
                  }`;
        setToast(msg);
        window.setTimeout(() => setToast(null), 4200);
        continue;
      }

      if (isAttackEvent(e)) {
        const summary = summaryFromEvent(e);
        if (!summary) continue;
        playUnderAttackSound();
        if (next.me.house) {
          setImpact({ at: next.me.house, startedAt: Date.now() });
          window.setTimeout(() => setImpact(null), 1600);
        }
        window.setTimeout(() => {
          setBattleSummary(summary);
          setShowBattles(false);
        }, 1500);
      }
    }
  }, []);

  const rememberIdentity = (id?: string | null) => {
    if (id && id.startsWith("guest_")) {
      try {
        window.localStorage.setItem(IDENT_KEY, id);
      } catch {
        /* storage unavailable */
      }
    }
  };

  const pollInFlight = useRef(false);
  const lastFullPollAt = useRef(0);

  const load = useCallback(async (opts?: { full?: boolean }) => {
    // Overlapping 4s polls while a slow sync is running inflated latency to 5s+
    if (pollInFlight.current) return;
    pollInFlight.current = true;

    const invite = captureInviteFromUrl();
    const wantFull =
      Boolean(opts?.full) ||
      Date.now() - lastFullPollAt.current > 60_000 ||
      lastFullPollAt.current === 0;
    const params = new URLSearchParams();
    if (invite) params.set("invite", invite);
    if (wantFull) params.set("full", "1");
    const q = params.toString() ? `?${params}` : "";
    const started = Date.now();
    setClientHealthRaw((h) => ({ ...h, lastAttemptAt: started }));
    try {
      const res = await fetch(`/api/game${q}`, { cache: "no-store" });
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || `Game sync HTTP ${res.status}`);
      }
      const data = (await res.json()) as GameSnapshot;
      if (wantFull) lastFullPollAt.current = Date.now();

      // Guest mode only: restore last guest if the cookie was reset.
      if (
        data.authDisabled &&
        !identityChecked.current &&
        typeof window !== "undefined"
      ) {
        identityChecked.current = true;
        let stored: string | null = null;
        try {
          stored = window.localStorage.getItem(IDENT_KEY);
        } catch {
          stored = null;
        }
        if (
          stored &&
          stored.startsWith("guest_") &&
          data.me &&
          data.me.id !== stored
        ) {
          try {
            const r2 = await fetch("/api/game", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "switch_player",
                targetId: stored,
              }),
            });
            if (r2.ok) {
              const restored = (await r2.json()) as GameSnapshot;
              applySnap(restored);
              setClientHealthRaw((h) => ({
                ...h,
                lastOkAt: Date.now(),
                lastLatencyMs: Date.now() - started,
                failStreak: 0,
                lastError: null,
                clockSkewMs:
                  typeof restored.serverNow === "number"
                    ? Date.now() - restored.serverNow
                    : h.clockSkewMs,
                online: navigator.onLine,
              }));
              return;
            }
          } catch {
            /* fall through to the fresh identity */
          }
        }
        rememberIdentity(data.me?.id);
      } else if (!identityChecked.current) {
        identityChecked.current = true;
      }

      // Light polls may omit history — keep last full sample for analytics
      const hasHistory =
        Boolean(data.sectorHistory) &&
        Object.keys(data.sectorHistory).length > 0;
      applySnap({
        ...data,
        sectorHistory: hasHistory
          ? data.sectorHistory
          : sectorHistoryRef.current,
      });
      setClientHealthRaw((h) => ({
        ...h,
        lastOkAt: Date.now(),
        lastLatencyMs: latencyMs,
        failStreak: 0,
        lastError: null,
        clockSkewMs:
          typeof data.serverNow === "number"
            ? Date.now() - data.serverNow
            : h.clockSkewMs,
        online: navigator.onLine,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Game sync failed";
      setClientHealthRaw((h) => ({
        ...h,
        failStreak: h.failStreak + 1,
        lastError: msg,
        lastLatencyMs: Date.now() - started,
        online: typeof navigator !== "undefined" ? navigator.onLine : h.online,
      }));
    } finally {
      pollInFlight.current = false;
    }
  }, [applySnap]);

  useEffect(() => {
    void load({ full: true });
    const id = window.setInterval(() => {
      // Don't poll-overwrite while a settle/build write is in flight
      if (busyRef.current || pollInFlight.current) return;
      void load();
    }, 4000);
    return () => window.clearInterval(id);
  }, [load]);

  const probeServerHealth = useCallback(async () => {
    setServerHealthLoading(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const data = (await res.json()) as ServerHealth;
      setServerHealth(data);
    } catch (err) {
      setServerHealth({
        ok: false,
        level: "down",
        checkedAt: Date.now(),
        latencyMs: 0,
        storage: {
          backend: "memory",
          reachable: false,
          latencyMs: null,
          error: err instanceof Error ? err.message : "Health probe failed",
        },
        game: { sectors: 0, players: 0, events: 0 },
        env: {
          authSecret: false,
          googleOAuth: false,
          mapbox: Boolean(process.env.NEXT_PUBLIC_MAPBOX_TOKEN),
          authDisabled: false,
        },
        issues: [
          err instanceof Error ? err.message : "Could not reach /api/health",
        ],
      });
    } finally {
      setServerHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    void probeServerHealth();
    const id = window.setInterval(() => {
      void probeServerHealth();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [probeServerHealth]);

  useEffect(() => {
    const onOnline = () =>
      setClientHealthRaw((h) => ({ ...h, online: true }));
    const onOffline = () =>
      setClientHealthRaw((h) => ({ ...h, online: false }));
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    setClientHealthRaw((h) => ({ ...h, online: navigator.onLine }));
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const clientHealth: ClientHealth = useMemo(() => {
    let localStorageOk = true;
    if (typeof window !== "undefined") {
      try {
        const k = "__itw_health__";
        window.localStorage.setItem(k, "1");
        window.localStorage.removeItem(k);
      } catch {
        localStorageOk = false;
      }
    }
    const mapboxToken = Boolean(
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim()
    );
    const snapshotAgeMs = clientHealthRaw.lastOkAt
      ? Date.now() - clientHealthRaw.lastOkAt
      : null;
    const issues: string[] = [];
    if (!clientHealthRaw.online) issues.push("Browser is offline");
    if (clientHealthRaw.failStreak >= 2) {
      issues.push(`${clientHealthRaw.failStreak} failed game syncs in a row`);
    }
    if (
      clientHealthRaw.lastLatencyMs != null &&
      clientHealthRaw.lastLatencyMs > 3000
    ) {
      issues.push(`Slow game sync (${clientHealthRaw.lastLatencyMs}ms)`);
    }
    if (snapshotAgeMs != null && snapshotAgeMs > 20_000) {
      issues.push("Game state looks stale");
    }
    if (
      clientHealthRaw.clockSkewMs != null &&
      Math.abs(clientHealthRaw.clockSkewMs) > 15_000
    ) {
      issues.push("Clock skew vs server is large");
    }
    if (!localStorageOk) issues.push("localStorage blocked");
    if (!mapboxToken) issues.push("Mapbox token missing in client build");

    const hardFail =
      !clientHealthRaw.online || clientHealthRaw.failStreak >= 3;
    return {
      level: levelFromIssues(issues, hardFail),
      online: clientHealthRaw.online,
      poll: {
        lastOkAt: clientHealthRaw.lastOkAt,
        lastAttemptAt: clientHealthRaw.lastAttemptAt,
        lastLatencyMs: clientHealthRaw.lastLatencyMs,
        failStreak: clientHealthRaw.failStreak,
        lastError: clientHealthRaw.lastError,
      },
      clockSkewMs: clientHealthRaw.clockSkewMs,
      localStorage: localStorageOk,
      mapboxToken,
      snapshotAgeMs,
      issues,
    };
  }, [clientHealthRaw]);

  const combinedHealthLevel = useMemo(() => {
    const levels = [clientHealth.level, serverHealth?.level ?? "unknown"];
    if (levels.includes("down")) return "down" as const;
    if (levels.includes("degraded")) return "degraded" as const;
    if (levels.includes("unknown")) return "unknown" as const;
    return "ok" as const;
  }, [clientHealth.level, serverHealth?.level]);

  // Smooth gold preview between syncs
  useEffect(() => {
    if (!snap?.me?.homeSectorId) {
      if (snap?.me) setDisplayGold(snap.me.gold);
      return;
    }
    const me = snap.me;
    const tripMs = snap.gatherTripMs;
    const easyYield = snap.spots
      .filter((s) => s.sectorId === me.homeSectorId && s.kind === "easy")
      .reduce((n, s) => n + s.yield, 0);
    const perTrip =
      me.villagers * (Math.max(1, easyYield) + buildingBonus(me.buildings));

    const tick = () => {
      const elapsed = Math.max(0, Date.now() - me.lastGatherAt);
      const trips = Math.floor(elapsed / tripMs);
      setDisplayGold(me.gold + trips * perTrip);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [snap]);

  const me = snap?.me ?? null;
  const selected = snap?.sectors.find((s) => s.id === selectedId) ?? null;
  const playerColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of snap?.players ?? []) {
      map.set(p.id, p.color || colorForPlayerId(p.id));
    }
    if (me) map.set(me.id, me.color || colorForPlayerId(me.id));
    return map;
  }, [snap?.players, me]);

  // CS-style corner feed: newest wars fade after a few seconds
  useEffect(() => {
    const source = snap?.globalEvents?.length
      ? snap.globalEvents
      : snap?.events ?? [];
    if (!source.length && killFeedPrimed.current) return;

    const newest = [...source].sort((a, b) => b.ts - a.ts);
    const now = Date.now();

    if (!killFeedPrimed.current) {
      killFeedPrimed.current = true;
      const seed = newest.slice(0, KILL_FEED_MAX);
      for (const e of newest) killFeedSeen.current.add(e.id);
      setKillFeed(
        seed.map((e, i) => ({
          id: e.id,
          event: e,
          // Stagger so the oldest seed lines fade first
          shownAt: now - i * 900,
        }))
      );
      return;
    }

    const additions: KillFeedItem[] = [];
    for (const e of newest) {
      if (killFeedSeen.current.has(e.id)) continue;
      killFeedSeen.current.add(e.id);
      additions.push({ id: e.id, event: e, shownAt: now });
    }
    if (!additions.length) return;
    playNotifySound();
    setKillFeed((prev) => [...additions, ...prev].slice(0, KILL_FEED_MAX));
  }, [snap?.globalEvents, snap?.events]);

  useEffect(() => {
    if (killFeed.length === 0) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setKillFeedNow(now);
      setKillFeed((prev) =>
        prev.filter((item) => now - item.shownAt < KILL_FEED_TTL_MS)
      );
    }, 200);
    return () => window.clearInterval(id);
  }, [killFeed.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prefer in-game settler name for chat / floating label
  useEffect(() => {
    const name = me?.name?.trim();
    if (!name || name.length < 2) return;
    if (name === displayName) return;
    renamePresence(name);
  }, [me?.name, displayName, renamePresence]);

  const claimed = Boolean(me?.homeSectorId);
  const isAzadPlayer = Boolean(
    me?.homeSectorId && isAzadHomeId(me.homeSectorId)
  );
  const needsHouseRebuild = Boolean(claimed && me && !me.house);

  // House gone → only house rebuild is allowed; drop any other placement
  useEffect(() => {
    if (!needsHouseRebuild) return;
    if (placing && placing.kind !== "house") {
      setPlacing(null);
    }
  }, [needsHouseRebuild, placing]);
  const homeName = isAzadPlayer
    ? AZAD_ARENA_NAME
    : snap?.sectors.find((s) => s.id === me?.homeSectorId)?.name ?? null;
  const myAttack = me ? attackPower(me.rockets || 0) : 0;
  const salvoAttack = attackPower(salvo);
  const settlersBySector = useMemo(() => {
    const map = new Map<string, NonNullable<typeof snap>["players"]>();
    for (const p of snap?.players ?? []) {
      if (!p.homeSectorId || isAzadHomeId(p.homeSectorId)) continue;
      const list = map.get(p.homeSectorId) ?? [];
      list.push(p);
      map.set(p.homeSectorId, list);
    }
    return map;
  }, [snap]);

  const enemyPlayer =
    (selectedPlayerId
      ? snap?.players.find((p) => p.id === selectedPlayerId)
      : null) ?? null;
  const enemyDefense = enemyPlayer
    ? defensePower({
        buildings: enemyPlayer.buildings,
        house: enemyPlayer.house,
        houseHp: enemyPlayer.houseHp,
        fortified: enemyPlayer.fortified,
      })
    : 0;

  // When targeting someone, suggest enough rockets to breach (+1 over defense)
  useEffect(() => {
    if (!me || !enemyPlayer) return;
    const stock = me.rockets || 0;
    if (stock <= 0) {
      setSalvo(1);
      return;
    }
    const need = Math.min(stock, Math.max(1, enemyDefense + 1));
    setSalvo(need);
  }, [selectedPlayerId, me?.rockets, enemyPlayer?.id, enemyDefense]); // eslint-disable-line react-hooks/exhaustive-deps

  const gemsFound = useMemo(() => {
    if (!me || !snap) return 0;
    const openMine = snap.spots.filter(
      (s) => s.claimable && s.ownerId === me.id
    ).length;
    const selfClaimed = me.discoveredSpotIds.filter((id) =>
      id.startsWith("find_")
    ).length;
    const stolenFromMe = (snap.events ?? []).filter(
      (e) => isGemClaimEvent(e) && e.defenderId === me.id
    ).length;
    return openMine + selfClaimed + stolenFromMe;
  }, [me, snap]);

  /** Sector leaderboard — mapped sectors only (Azad ranked separately) */
  const sectorRanking = useMemo(() => {
    const bySector = new Map<
      string,
      { id: string; name: string; farmed: number; settlers: number }
    >();
    for (const s of snap?.sectors ?? []) {
      bySector.set(s.id, { id: s.id, name: s.name, farmed: 0, settlers: 0 });
    }
    for (const p of snap?.players ?? []) {
      if (!p.homeSectorId || isAzadHomeId(p.homeSectorId)) continue;
      const row = bySector.get(p.homeSectorId);
      if (!row) continue;
      row.farmed += p.totalFarmed || 0;
      row.settlers += 1;
    }
    return Array.from(bySector.values()).sort((a, b) => b.farmed - a.farmed);
  }, [snap]);

  /** Top individual scorer inside the player's home sector */
  const homeSectorTopPlayerId = useMemo(() => {
    if (!me?.homeSectorId || isAzadHomeId(me.homeSectorId)) return null;
    let bestId: string | null = null;
    let best = -1;
    for (const p of snap?.players ?? []) {
      if (p.homeSectorId !== me.homeSectorId) continue;
      const farmed = p.totalFarmed || 0;
      if (farmed > best) {
        best = farmed;
        bestId = p.id;
      }
    }
    return bestId;
  }, [me?.homeSectorId, snap?.players]);

  const canRenameHomeSector = Boolean(
    me && homeSectorTopPlayerId && me.id === homeSectorTopPlayerId
  );

  const homeSectorRecord = useMemo(() => {
    if (!me?.homeSectorId || isAzadHomeId(me.homeSectorId)) return null;
    return snap?.sectors.find((s) => s.id === me.homeSectorId) ?? null;
  }, [me?.homeSectorId, snap?.sectors]);

  const openSectorRename = useCallback(() => {
    if (!homeSectorRecord || !canRenameHomeSector) return;
    setSectorTagDraft(homeSectorRecord.tag?.trim() || "");
    setShowSectorRename(true);
    setShowRanks(false);
    setShowMenu(false);
  }, [homeSectorRecord, canRenameHomeSector]);

  const saveSectorRename = useCallback(async () => {
    if (!homeSectorRecord || !canRenameHomeSector || sectorRenameSaving) return;
    setSectorRenameSaving(true);
    try {
      const data = await act(
        "rename_sector",
        { sectorId: homeSectorRecord.id, tag: sectorTagDraft },
        "Naming sector…"
      );
      if (data) {
        setShowSectorRename(false);
        showToast(
          sectorTagDraft.trim()
            ? `Sector named ${String((data as { name?: string }).name || homeSectorRecord.name)}`
            : "Sector tag cleared"
        );
      }
    } finally {
      setSectorRenameSaving(false);
    }
  }, [
    homeSectorRecord,
    canRenameHomeSector,
    sectorRenameSaving,
    sectorTagDraft,
    // act / showToast are stable enough via closure for this shell
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Modal when you become #1 in your sector (also after reclaiming the crown)
  useEffect(() => {
    if (canRenameHomeSector && homeSectorRecord) {
      if (!wasSectorTop.current) {
        wasSectorTop.current = true;
        setSectorTagDraft(homeSectorRecord.tag?.trim() || "");
        setShowSectorRename(true);
      }
    } else {
      wasSectorTop.current = false;
    }
  }, [canRenameHomeSector, homeSectorRecord]);

  const sectorAnalyticsRows = useMemo(
    () =>
      mappedSectorAnalytics(
        snap?.sectors ?? [],
        snap?.players ?? [],
        snap?.spots ?? [],
        snap?.sectorHistory ?? {}
      ),
    [snap]
  );

  const openSectorAnalytics = useCallback((sectorId?: string | null) => {
    setAnalyticsSectorId(sectorId ?? null);
    setShowAnalytics(true);
    setShowRanks(false);
    setShowMenu(false);
    setShowBattles(false);
    setShowMissions(false);
    setShowInvite(false);
    setShowActivity(false);
    void load({ full: true });
  }, [load]);

  /** Azad Umeed Wars — individual ranking by total farmed */
  const azadRanking = useMemo(() => {
    return (snap?.players ?? [])
      .filter((p) => p.homeSectorId && isAzadHomeId(p.homeSectorId))
      .map((p) => ({
        id: p.id,
        name: p.name,
        farmed: p.totalFarmed || 0,
        house: p.house,
      }))
      .sort((a, b) => b.farmed - a.farmed);
  }, [snap]);

  const topSectors = sectorRanking.slice(0, 5);
  const topAzad = azadRanking.slice(0, 5);

  /** HUD board: top 5, plus your sector with real rank if outside top 5 */
  const sectorBoard = useMemo(() => {
    if (isAzadPlayer || azadMode) {
      const rows = topAzad.map((r, i) => ({
        id: r.id,
        name: r.name,
        farmed: r.farmed,
        settlers: 1,
        rank: i + 1,
        mine: me?.id === r.id,
        azad: true as const,
        house: r.house,
      }));
      if (!me || rows.some((r) => r.mine)) return rows;
      const idx = azadRanking.findIndex((r) => r.id === me.id);
      if (idx < 0) return rows;
      const mine = azadRanking[idx]!;
      return [
        ...rows,
        {
          id: mine.id,
          name: mine.name,
          farmed: mine.farmed,
          settlers: 1,
          rank: idx + 1,
          mine: true,
          azad: true as const,
          house: mine.house,
        },
      ];
    }
    const rows = topSectors.map((r, i) => ({
      ...r,
      rank: i + 1,
      mine: me?.homeSectorId === r.id,
      azad: false as const,
      house: null as { lat: number; lng: number } | null,
    }));
    const homeId = me?.homeSectorId;
    if (!homeId || isAzadHomeId(homeId)) return rows;
    if (rows.some((r) => r.id === homeId)) return rows;
    const idx = sectorRanking.findIndex((r) => r.id === homeId);
    if (idx < 0) return rows;
    const mine = sectorRanking[idx]!;
    return [
      ...rows,
      {
        ...mine,
        rank: idx + 1,
        mine: true,
        azad: false as const,
        house: null as { lat: number; lng: number } | null,
      },
    ];
  }, [
    topSectors,
    sectorRanking,
    topAzad,
    azadRanking,
    me,
    isAzadPlayer,
    azadMode,
  ]);

  const missionList = useMemo(() => {
    if (!me) return [];
    return [
      {
        id: "settle",
        label: isAzadHomeId(me.homeSectorId)
          ? `Settle in ${AZAD_ARENA_NAME}`
          : "Settle in a sector",
        done: Boolean(me.homeSectorId),
      },
      {
        id: "watch",
        label: "Earn gold from automatic gathering",
        done: me.gold > 0,
      },
      {
        id: "explore",
        label: "Roam until a resource appears, then claim it",
        done: gemsFound >= 1,
      },
      {
        id: "build",
        label: "Place your first building",
        done: me.buildings.length >= 1,
      },
      {
        id: "arsenal",
        label: "Buy a rocket for your arsenal",
        done: (me.rockets || 0) >= 1,
      },
      {
        id: "invite",
        label: "Invite a friend (+1 villager)",
        done: (snap?.inviteCount ?? 0) >= 1,
      },
      {
        id: "review",
        label: `Review a local business (+${REVIEW_VILLAGER_BONUS} villager)`,
        done: (me.reviewedPlaceIds?.length ?? 0) >= 1,
      },
    ];
  }, [me, gemsFound, snap?.inviteCount]);

  const flexUnlocked = useMemo(() => {
    if (!me || !snap) return false;
    return canUnlockFlexVehicles(me, [
      ...snap.players,
      {
        id: me.id,
        homeSectorId: me.homeSectorId,
        totalFarmed: me.totalFarmed,
      },
    ]);
  }, [me, snap]);

  const showToast = (msg: string) => {
    setToast(msg);
    playNotifySound();
    window.setTimeout(() => setToast(null), 3400);
  };

  const act = async (
    action: string,
    extra: Record<string, unknown> = {},
    label?: string,
    opts?: { silent?: boolean }
  ) => {
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setBusy(true);
      busyRef.current = true;
      if (label) setSavingLabel(label);
    }
    setError(null);
    lastActionErrorRef.current = null;
    try {
      const invite = readStoredInvite();
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          sectorId: selectedId,
          ...(invite ? { invite } : {}),
          ...extra,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = String(data.error || "Action failed");
        lastActionErrorRef.current = msg;
        setError(msg);
        window.setTimeout(() => setError(null), 3200);
        return null;
      }
      if (
        action === "claim_sector" ||
        action === "claim_azad" ||
        action === "place_house" ||
        action === "build"
      ) {
        settleGuardUntil.current = Date.now() + 20_000;
      }
      applySnap(data as GameSnapshot);
      return data;
    } catch {
      lastActionErrorRef.current = "Network error — try again";
      setError("Network error — try again");
      window.setTimeout(() => setError(null), 3200);
      return null;
    } finally {
      if (!silent) {
        setBusy(false);
        busyRef.current = false;
        setSavingLabel(null);
      }
    }
  };

  const spawnFind = async (payload: {
    lat: number;
    lng: number;
    bearing: number;
    zoom: number;
    roamMeters: number;
    exploreMs: number;
  }): Promise<boolean> => {
    try {
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "spawn_find", ...payload }),
      });
      const data = await res.json();
      if (!res.ok) return false;
      applySnap(data as GameSnapshot);
      playGemSpawnSound();
      const gem = String(data.gem || "resource");
      const label = `${gem[0]!.toUpperCase()}${gem.slice(1)}`;
      showToast(`${label} appeared — tap to claim before others do!`);
      return true;
    } catch {
      return false;
    }
  };

  /** Claim a gem/find — no busy lock; top loader while the server writes */
  const claimHidden = async (spotId: string) => {
    if (!spotId || claimingSpotIdsRef.current.includes(spotId)) return;
    const spot = snap?.spots.find((s) => s.id === spotId) ?? null;

    claimingSpotIdsRef.current = [...claimingSpotIdsRef.current, spotId];
    setClaimingSpotIds(claimingSpotIdsRef.current);

    // Optimistic: pull it off the map immediately so taps feel instant
    if (spot) {
      setSnap((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          spots: prev.spots.filter((s) => s.id !== spotId),
        };
      });
    }

    try {
      const invite = readStoredInvite();
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "collect_hidden",
          spotId,
          ...(invite ? { invite } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Put the gem back if the server rejected the claim
        if (spot) {
          setSnap((prev) => {
            if (!prev) return prev;
            if (prev.spots.some((s) => s.id === spotId)) return prev;
            return { ...prev, spots: [...prev.spots, spot] };
          });
        }
        setError(data.error || "Couldn't claim that find");
        window.setTimeout(() => setError(null), 3200);
        return;
      }
      applySnap(data as GameSnapshot);
      if (data?.gained) {
        playCoinSound();
        const gem = String(data.gem || "gem");
        const label = `${gem[0]!.toUpperCase()}${gem.slice(1)}`;
        if (data.stolen && data.ownerName) {
          showToast(
            `Snatched ${personName(String(data.ownerName))}'s ${label} +${GOLD_COIN}${data.gained}`
          );
        } else {
          showToast(`Claimed ${label} +${GOLD_COIN}${data.gained}`);
        }
      }
    } catch {
      if (spot) {
        setSnap((prev) => {
          if (!prev) return prev;
          if (prev.spots.some((s) => s.id === spotId)) return prev;
          return { ...prev, spots: [...prev.spots, spot] };
        });
      }
      setError("Network error — try claiming again");
      window.setTimeout(() => setError(null), 3200);
    } finally {
      claimingSpotIdsRef.current = claimingSpotIdsRef.current.filter(
        (id) => id !== spotId
      );
      setClaimingSpotIds([...claimingSpotIdsRef.current]);
    }
  };

  /** Lock a pin: auto-pick matching sector, else Azad */
  const lockLocation = (
    lat: number,
    lng: number,
    opts?: { forceAzad?: boolean; quiet?: boolean; keepManual?: boolean }
  ) => {
    setLiveLocation({ lat, lng });
    setLocationFocus((n) => n + 1);
    setPickingPin(false);
    setLocStatus("ok");
    setError(null);
    setSelectedPlayerId(null);
    setRazeTarget(null);
    if (!opts?.keepManual) setManualMode(false);

    if (opts?.forceAzad) {
      setAzadMode(true);
      setSelectedId(null);
      setGpsFix({ sectorId: AZAD_PENDING_ID, lat, lng });
      if (!opts?.quiet) showToast(`Location set — ${AZAD_ARENA_NAME}`);
      return;
    }

    const match = snap?.sectors.find((s) =>
      pointInOrNearRing({ lat, lng }, s.ring, 120)
    );
    if (match) {
      setAzadMode(false);
      setSelectedId(match.id);
      setGpsFix({ sectorId: match.id, lat, lng });
      if (!opts?.quiet) showToast(`Pinned in ${match.name}`);
      return;
    }

    setAzadMode(true);
    setSelectedId(null);
    setGpsFix({ sectorId: AZAD_PENDING_ID, lat, lng });
    if (!opts?.quiet) showToast(`Off the map — ${AZAD_ARENA_NAME}`);
  };

  /** Path A: device GPS */
  const useGpsLocation = () => {
    setManualMode(false);
    setPickingPin(false);
    pinDropAzad.current = false;
    if (!navigator.geolocation) {
      setLocStatus("failed");
      setError("GPS isn’t available here — choose a sector on the map instead");
      window.setTimeout(() => setError(null), 4200);
      return;
    }
    setGpsBusy(true);
    setLocStatus("reading");
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsBusy(false);
        lockLocation(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setGpsBusy(false);
        setLocStatus("failed");
        setGpsFix(null);
        setError(
          "Couldn’t read GPS — allow location access, or choose a sector on the map"
        );
        window.setTimeout(() => setError(null), 4800);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  };

  /** Path B: open manual picker (list + map pin) */
  const startManualPick = () => {
    setManualMode(true);
    setGpsFix(null);
    setAzadMode(false);
    setLocStatus("idle");
    pinDropAzad.current = false;
    setError(null);
    if (!liveLocation) {
      setPickingPin(true);
      showToast("Tap the map to place your pin, or pick a sector below");
    } else {
      setPickingPin(false);
      lockLocation(liveLocation.lat, liveLocation.lng, {
        keepManual: true,
        quiet: true,
      });
    }
  };

  /** Manual: pick a named sector — pin drops at its center */
  const pickSectorFromList = (sectorId: string) => {
    const sector = snap?.sectors.find((s) => s.id === sectorId);
    if (!sector) return;
    const center = ringCentroid(sector.ring);
    setManualMode(true);
    setSectorFocus((n) => n + 1);
    lockLocation(center.lat, center.lng, { keepManual: true });
  };

  // Audio: Volt-style UI clicks/hovers + unlock / resume music pref
  useEffect(() => {
    installUiSounds();
    const unlock = () => {
      unlockAudio();
      if (readMusicPref() && !isMusicOn()) {
        startMusic();
        setMusicOn(true);
      }
      window.removeEventListener("pointerdown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  const handleNpcPlace = async (lat: number, lng: number) => {
    if (!npcPlacing) return;
    if (npcPlacing === "cda_hq") {
      const data = await act(
        "admin_place_cda_hq",
        { lat, lng },
        "Placing CDA Head Office…"
      );
      if (data) {
        playBuildSound();
        showToast("CDA Head Office set — raid trucks will dispatch from here");
        setNpcPlacing(null);
      }
      return;
    }
    if (npcPlacing === "spy_sat") {
      if (plantingSat || busyRef.current) return;
      setPlantingSat(true);
      try {
        const data = await act(
          "plant_spy_sat",
          { lat, lng },
          undefined,
          { silent: true }
        );
        if (data) {
          playNpcEngageSound();
          showToast("Spy satellite planted — draining their gold quietly");
          setNpcPlacing(null);
        }
      } finally {
        setPlantingSat(false);
      }
    }
  };

  const handleSelectNpc = async (npc: WorldNpc) => {
    if (npc.kind === "spy_sat" && npc.phase === "active") {
      const canSmash =
        npc.targetPlayerId === me?.id || npc.ownerPlayerId === me?.id;
      if (!canSmash) {
        showToast("Zoom in — someone's spying here");
        return;
      }
      playNpcEngageSound();
      const data = await act(
        "destroy_spy_sat",
        { npcId: npc.id },
        "Destroying spy sat…"
      );
      if (data) {
        showToast(
          npc.ownerPlayerId === me?.id
            ? "Spy sat recalled"
            : `Destroyed ${npc.ownerName || "someone"}'s spy sat`
        );
      }
      return;
    }
    if (npc.kind === "cda_truck") {
      if (npc.phase !== "parked" && npc.phase !== "traveling") {
        showToast("That truck already left");
        return;
      }
      playNpcEngageSound();
      const origin = liveLocation ?? me?.house ?? me?.villagerPost;
      const data = await act(
        "chase_cda_truck",
        {
          npcId: npc.id,
          lat: origin?.lat,
          lng: origin?.lng,
        },
        "Chasing off raid truck…"
      );
      if (data) {
        showToast(
          typeof (data as { message?: string }).message === "string"
            ? (data as { message: string }).message
            : "Raid truck chased off!"
        );
      }
    }
  };

  const handlePlace = async (lat: number, lng: number) => {
    if (!placing) return;
    // Block settle/rebuild while a full-screen save is in flight;
    // building places use optimistic sync and may run in parallel.
    const isBuildingPlace =
      placing.kind !== "house" && placing.kind !== "villager";
    if (!isBuildingPlace && busyRef.current) return;

    if (placing.kind === "house") {
      const pos = { lat, lng };
      const unbound =
        isAzadHomeId(placing.sector.id) || placing.sector.ring.length < 4;
      if (!unbound && !pointInRing(pos, placing.sector.ring)) {
        setError("Place your base inside the sector");
        window.setTimeout(() => setError(null), 3200);
        return;
      }
      const occupied = housePlacementError(
        pos,
        snapRef.current?.players ?? snap?.players ?? [],
        me?.id
      );
      if (occupied) {
        setError(occupied);
        window.setTimeout(() => setError(null), 3200);
        return;
      }

      // Rebuild after house was razed — keep existing villager post, no redeploy
      const rebuildingHome =
        me?.homeSectorId === placing.sector.id ||
        (Boolean(me?.homeSectorId) &&
          isAzadHomeId(me!.homeSectorId) &&
          (placing.sector.id === AZAD_PENDING_ID ||
            isAzadHomeId(placing.sector.id)));
      if (rebuildingHome) {
        const data = await act(
          "place_house",
          { lat: pos.lat, lng: pos.lng },
          "Rebuilding your base…"
        );
        if (data) {
          playBuildSound();
          showToast("Base rebuilt — villagers are gathering again");
          setPlacing(null);
          setPendingHouse(null);
        }
        return;
      }

      // First settle: stash the house; flow waits for the Villager tile next
      setPendingHouse(pos);
      if (settleSector) {
        setPlacing(null);
        showToast("Base set — tap Villager, then place them on the map");
      } else {
        setPlacing({ kind: "villager", sector: placing.sector });
        showToast("Base set — now place your villager nearby");
      }
      return;
    }

    if (placing.kind === "villager") {
      if (!pendingHouse) {
        setPlacing({ kind: "house", sector: placing.sector });
        return;
      }

      const settlingAzad =
        azadMode ||
        isAzadHomeId(placing.sector.id) ||
        placing.sector.id === AZAD_PENDING_ID;

      if (
        !gpsFix ||
        (!settlingAzad && gpsFix.sectorId !== placing.sector.id) ||
        (settlingAzad && gpsFix.sectorId !== AZAD_PENDING_ID)
      ) {
        setError(
          settlingAzad
            ? "Confirm your GPS location first"
            : "Confirm your GPS location in this sector first"
        );
        window.setTimeout(() => setError(null), 3200);
        setPlacing(null);
        setPendingHouse(null);
        return;
      }

      const data = settlingAzad
        ? await act(
            "claim_azad",
            {
              lat: pendingHouse.lat,
              lng: pendingHouse.lng,
              villagerLat: lat,
              villagerLng: lng,
              gpsLat: gpsFix.lat,
              gpsLng: gpsFix.lng,
            },
            "Founding your village…"
          )
        : await act(
            "claim_sector",
            {
              sectorId: placing.sector.id,
              lat: pendingHouse.lat,
              lng: pendingHouse.lng,
              villagerLat: lat,
              villagerLng: lng,
              gpsLat: gpsFix.lat,
              gpsLng: gpsFix.lng,
            },
            "Founding your village…"
          );
      if (data) {
        playBuildSound();
        showToast(
          settlingAzad
            ? `Settled in ${AZAD_ARENA_NAME} — your village is live!`
            : `Settled in ${placing.sector.name} — your village is live!`
        );
        setPlacing(null);
        setPendingHouse(null);
        setSettleSector(null);
        setGpsFix(null);
        setPickingPin(false);
        if (settlingAzad) setAzadMode(true);
        // Tips only after settle — never during location setup
        if (!tipsArmed.current && !readWalkthroughDone()) {
          tipsArmed.current = true;
          window.setTimeout(() => setShowWalkthrough(true), 400);
        }
      } else if (isOccupiedGroundError(lastActionErrorRef.current)) {
        // House was on occupied ground — don't leave them stuck on step 2
        setPendingHouse(null);
        setPlacing({ kind: "house", sector: placing.sector });
      }
      // Other errors (villager distance, GPS): stay on villager to adjust
      return;
    }

    // Building placement — show on the map immediately, sync in background
    if (!me || !snap) return;
    const kind = placing.kind as BuildingType;
    const cat =
      snap.buildingCatalog.find((b) => b.type === kind) ?? catalogItem(kind);
    if (displayGold < cat.cost) {
      setError(`Need ${formatGold(cat.cost)}`);
      window.setTimeout(() => setError(null), 3200);
      return;
    }

    const buildBlocked = buildingPlacementError(
      { lat, lng },
      cat.footprintM,
      snapRef.current?.players ?? snap.players,
      me.id
    );
    if (buildBlocked) {
      setError(buildBlocked);
      window.setTimeout(() => setError(null), 3200);
      return;
    }

    const tempId = `pending_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 5)}`;
    const optimistic: Building = {
      id: tempId,
      type: kind,
      lat,
      lng,
      hp: cat.hp,
      builtAt: Date.now(),
    };
    const nextMe: Player = {
      ...me,
      gold: me.gold - cat.cost,
      buildings: [...me.buildings, optimistic],
      updatedAt: Date.now(),
    };

    setSnap((prev) => {
      if (!prev?.me) return prev;
      return {
        ...prev,
        me: nextMe,
        players: prev.players.map((p) =>
          p.id === nextMe.id
            ? {
                ...p,
                gold: nextMe.gold,
                buildings: nextMe.buildings,
              }
            : p
        ),
      };
    });
    setDisplayGold(nextMe.gold);
    lastGoodMe.current = nextMe;
    settleGuardUntil.current = Date.now() + 20_000;
    setPlacing(null);
    setSyncingBuilds((list) => [...list, { id: tempId, type: kind }]);
    playBuildSound();

    const data = await act(
      "build",
      { buildingType: kind, lat, lng },
      undefined,
      { silent: true }
    );
    setSyncingBuilds((list) => list.filter((b) => b.id !== tempId));
    if (!data) {
      // Roll back optimistic place
      setSnap((prev) => {
        if (!prev?.me) return prev;
        const rolled: Player = {
          ...prev.me,
          gold: prev.me.gold + cat.cost,
          buildings: prev.me.buildings.filter((b) => b.id !== tempId),
          updatedAt: Date.now(),
        };
        lastGoodMe.current = rolled.homeSectorId ? rolled : lastGoodMe.current;
        return {
          ...prev,
          me: rolled,
          players: prev.players.map((p) =>
            p.id === rolled.id
              ? {
                  ...p,
                  gold: rolled.gold,
                  buildings: rolled.buildings,
                }
              : p
          ),
        };
      });
      setDisplayGold((g) => g + cat.cost);
      return;
    }
    showToast(
      kind === "shovel"
        ? "Shovel ready — tap it on the map to dig for gold"
        : kind === "civic" || kind === "prado" || kind === "landcruiser"
          ? `${catalogItem(kind).name} parked — flex unlocked`
          : "Building synced"
    );
  };

  const cancelPlacement = () => {
    setPlacing(null);
    setPendingHouse(null);
    // First-time settle: keep the sector dock so a bad house drop isn't a dead end
    if (!isSettlePlacing && !claimed) setSettleSector(null);
  };

  const flashPlaceBlocked = useCallback((message: string) => {
    setError(message);
    window.setTimeout(() => setError(null), 3200);
  }, []);

  /** First-time settle: bottom tiles drive house → villager one by one */
  const isSettlePlacing = Boolean(settleSector && !claimed);

  const dismissBattle = useCallback(() => {
    writeBattleAck(Date.now());
    setBattleSummary(null);
    playModalCloseSound();
  }, []);

  const dismissRazeAlert = useCallback(() => {
    if (razeAlert) {
      writeBattleAck(Math.max(readBattleAck(), razeAlert.ts));
    }
    setRazeAlert(null);
    playModalCloseSound();
  }, [razeAlert]);

  const dismissGemClaimAlert = useCallback(() => {
    if (gemClaimAlert) {
      writeBattleAck(Math.max(readBattleAck(), gemClaimAlert.ts));
    }
    setGemClaimAlert(null);
    playModalCloseSound();
  }, [gemClaimAlert]);

  // Error toast SFX
  useEffect(() => {
    if (error) playErrorSound();
  }, [error]);

  // Alert / modal open SFX (id-keyed so a new report while one is up still chirps)
  useEffect(() => {
    if (battleSummary) playModalOpenSound();
  }, [battleSummary?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (razeAlert) playModalOpenSound();
  }, [razeAlert?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (gemClaimAlert) playModalOpenSound();
  }, [gemClaimAlert?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // NPC threat banners — play when a new sat/truck threat appears
  const spyThreatKey = (snap?.activeSpyThreats ?? [])
    .map((s) => s.id)
    .sort()
    .join(",");
  const raidTruckKey = snap?.activeRaidTruck
    ? `${snap.activeRaidTruck.id}:${snap.activeRaidTruck.phase}`
    : "";
  useEffect(() => {
    const keys: string[] = [];
    for (const sat of snap?.activeSpyThreats ?? []) {
      keys.push(`sat:${sat.id}`);
    }
    if (snap?.activeRaidTruck?.phase === "parked") {
      keys.push(`truck:${snap.activeRaidTruck.id}:parked`);
    } else if (snap?.activeRaidTruck?.phase === "traveling") {
      keys.push(`truck:${snap.activeRaidTruck.id}:traveling`);
    }
    let played = false;
    for (const k of keys) {
      if (seenNpcThreats.current.has(k)) continue;
      seenNpcThreats.current.add(k);
      played = true;
    }
    // Drop stale ids so a future re-visit can alert again
    for (const k of Array.from(seenNpcThreats.current)) {
      if (!keys.includes(k)) {
        const id = k.split(":")[1];
        if (!keys.some((x) => x.includes(`:${id}`))) {
          seenNpcThreats.current.delete(k);
        }
      }
    }
    if (played) playNpcThreatSound();
  }, [spyThreatKey, raidTruckKey, snap?.activeSpyThreats, snap?.activeRaidTruck]);

  // Corner toasts auto-dismiss after 7s
  useEffect(() => {
    if (!razeAlert) return;
    const t = window.setTimeout(dismissRazeAlert, 7000);
    return () => window.clearTimeout(t);
  }, [razeAlert, dismissRazeAlert]);

  useEffect(() => {
    if (!gemClaimAlert) return;
    const t = window.setTimeout(dismissGemClaimAlert, 7000);
    return () => window.clearTimeout(t);
  }, [gemClaimAlert, dismissGemClaimAlert]);

  useEffect(() => {
    if (!battleSummary) return;
    const t = window.setTimeout(dismissBattle, 7000);
    return () => window.clearTimeout(t);
  }, [battleSummary, dismissBattle]);

  // Enable "I left a review" after Maps has been open ~15s
  useEffect(() => {
    if (!reviewBiz || reviewOpenedAt == null) {
      setReviewReady(false);
      return;
    }
    const left = 15_000 - (Date.now() - reviewOpenedAt);
    if (left <= 0) {
      setReviewReady(true);
      return;
    }
    setReviewReady(false);
    const t = window.setTimeout(() => setReviewReady(true), left);
    return () => window.clearTimeout(t);
  }, [reviewBiz, reviewOpenedAt]);

  const launchAttack = async () => {
    if (!me?.house || !enemyPlayer) return;
    const b0 = enemyPlayer.buildings[0];
    const target =
      enemyPlayer.house ??
      (b0 ? { lat: b0.lat, lng: b0.lng } : null);
    if (!target) return;
    const targetSector =
      snap?.sectors.find((s) => s.id === enemyPlayer.homeSectorId) ?? null;
    const defenderName = enemyPlayer.name;
    const rockets = Math.max(1, Math.min(me.rockets || 0, salvo));
    const durationMs = 2400 + Math.min(900, (rockets - 1) * 120);
    const marchStarted = Date.now();
    // Close the attack sheet so the bezier flight stays visible
    setSelectedPlayerId(null);
    setMarch({
      from: me.house,
      to: target,
      startedAt: marchStarted,
      durationMs,
      count: rockets,
    });
    playRocketLaunchSound();
    playAttackSound();
    const data = await act("attack", {
      targetPlayerId: enemyPlayer.id,
      rockets,
    });
    const battle = data?.battle as BattleReport | undefined;

    if (!data || !battle) {
      setMarch(null);
      return;
    }

    const summary = summaryFromAttack(
      battle,
      targetSector?.name ?? "their village",
      defenderName
    );
    // Wait until the march finishes, then impact + report.
    const remaining = Math.max(0, durationMs - (Date.now() - marchStarted));
    window.setTimeout(() => {
      setMarch(null);
      setImpact({ at: target, startedAt: Date.now() });
      playExplosionSound();
      window.setTimeout(() => setImpact(null), 1700);
      setBattleSummary(summary);
      setShowBattles(false);
    }, remaining);
  };

  /** Prefer the public wars host so shared links never point at a Vercel preview */
  const inviteOrigin = (() => {
    const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
    if (env) return env;
    if (typeof window === "undefined") return "";
    const origin = window.location.origin;
    if (/vercel\.app$/i.test(window.location.hostname)) {
      return "https://www.wars.usama.fun";
    }
    return origin;
  })();
  const inviteLink =
    inviteOrigin && me?.inviteCode
      ? `${inviteOrigin}/play?invite=${encodeURIComponent(me.inviteCode)}`
      : "";

  const perTrip =
    me?.homeSectorId && me.house && snap
      ? me.villagers *
        (Math.max(
          1,
          snap.spots
            .filter(
              (s) => s.sectorId === me.homeSectorId && s.kind === "easy"
            )
            .reduce((n, s) => n + s.yield, 0)
        ) +
          buildingBonus(me.buildings))
      : 0;

  const missionsDone = missionList.filter((m) => m.done).length;

  const settlersHere = selected
    ? settlersBySector.get(selected.id) ?? []
    : [];
  const canAttackEnemy = Boolean(
    enemyPlayer &&
      me?.homeSectorId &&
      enemyPlayer.id !== me.id &&
      enemyPlayer.homeSectorId &&
      enemyPlayer.homeSectorId !== me.homeSectorId
  );
  /** Attack modal after tapping any enemy house/building */
  const enemySelected = claimed && canAttackEnemy;

  const razeOwner = razeTarget
    ? snap?.players.find((p) => p.id === razeTarget.playerId) ?? null
    : null;
  const razeBuilding = razeOwner?.buildings.find(
    (b) => b.id === razeTarget?.buildingId
  );
  const canRazeSelected = Boolean(
    claimed &&
      me?.homeSectorId &&
      razeOwner &&
      razeBuilding &&
      razeOwner.id !== me.id &&
      razeOwner.homeSectorId === me.homeSectorId
  );
  const razeBuildingHp = razeBuilding?.hp ?? 0;
  const razeSalvoAttack = attackPower(salvo);

  // When clearing an ally building, suggest enough rockets to finish its HP
  useEffect(() => {
    if (!me || !razeBuilding) return;
    const stock = me.rockets || 0;
    if (stock <= 0) {
      setSalvo(1);
      return;
    }
    const need = Math.min(stock, Math.max(1, razeBuilding.hp || 1));
    setSalvo(need);
  }, [razeTarget?.buildingId, me?.rockets, razeBuilding?.hp]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmRaze = async () => {
    if (!razeTarget || !razeBuilding || !razeOwner || !me?.house) return;
    if ((me.rockets || 0) <= 0) {
      setError("Buy rockets before clearing ground");
      window.setTimeout(() => setError(null), 3200);
      return;
    }
    const name = catalogItem(razeBuilding.type).name;
    const ownerName = razeOwner.name;
    const rockets = Math.max(1, Math.min(me.rockets || 0, salvo));
    const target = { lat: razeBuilding.lat, lng: razeBuilding.lng };
    const durationMs = 2000 + Math.min(800, (rockets - 1) * 100);
    const marchStarted = Date.now();
    const targetPlayerId = razeTarget.playerId;
    const buildingId = razeTarget.buildingId;
    // Clear sheet + skip the blocking “saving” modal so the flight is visible
    setRazeTarget(null);
    setMarch({
      from: me.house,
      to: target,
      startedAt: marchStarted,
      durationMs,
      count: rockets,
    });
    playRocketLaunchSound();
    playAttackSound();
    const data = await act("raze_building", {
      targetPlayerId,
      buildingId,
      rockets,
    });
    if (!data) {
      setMarch(null);
      return;
    }
    const raze = data.raze as
      | {
          destroyed?: boolean;
          damage?: number;
          rocketsLost?: number;
          buildingHp?: number;
        }
      | undefined;
    const remaining = Math.max(0, durationMs - (Date.now() - marchStarted));
    window.setTimeout(() => {
      setMarch(null);
      setImpact({ at: target, startedAt: Date.now() });
      playExplosionSound();
      window.setTimeout(() => setImpact(null), 1700);
      if (raze?.destroyed) {
        showToast(
          `Destroyed ${ownerName}'s ${name} (${raze.rocketsLost ?? rockets} rocket${
            (raze.rocketsLost ?? rockets) === 1 ? "" : "s"
          })`
        );
      } else {
        showToast(
          `Attacked ${ownerName}'s ${name} — ${raze?.damage ?? razeSalvoAttack} dmg, ${
            raze?.buildingHp ?? "?"
          } HP left`
        );
      }
    }, remaining);
  };

  const confirmTroop = async () => {
    if (!razeTarget || !razeBuilding || !razeOwner || !me) return;
    if (!hasBarracks(me) || (me.troops || 0) <= 0) {
      setError("Recruit a troop at the Barracks first");
      window.setTimeout(() => setError(null), 3200);
      return;
    }
    const name = catalogItem(razeBuilding.type).name;
    const ownerName = razeOwner.name;
    const targetPlayerId = razeTarget.playerId;
    const buildingId = razeTarget.buildingId;
    setRazeTarget(null);
    const data = await act("send_troop", { targetPlayerId, buildingId });
    if (!data) return;
    const sabotage = data.sabotage as
      | {
          destroyed?: boolean;
          damage?: number;
          buildingHp?: number;
        }
      | undefined;
    playAttackSound();
    if (sabotage?.destroyed) {
      showToast(`Troop destroyed ${ownerName}'s ${name}`);
    } else {
      showToast(
        `Troop hit ${ownerName}'s ${name} — ${sabotage?.damage ?? TROOP_DAMAGE} dmg, ${
          sabotage?.buildingHp ?? "?"
        } HP left`
      );
    }
  };

  const openShovel = (buildingId: string) => {
    setSelectedPlayerId(null);
    setRazeTarget(null);
    setManageBuildingId(buildingId);
    setShovelId(buildingId);
    if (!readShovelIntroDone()) {
      setShowShovelIntro(true);
    }
  };

  const openOwnBuilding = (buildingId: string) => {
    setSelectedPlayerId(null);
    setRazeTarget(null);
    const b = me?.buildings.find((x) => x.id === buildingId);
    if (b?.type === "shovel") {
      // shovel path handled by openShovel
      return;
    }
    setShovelId(null);
    setManageBuildingId(buildingId);
  };

  const dismissShovelIntro = () => {
    markShovelIntroDone();
    setShowShovelIntro(false);
  };

  const closeShovel = useCallback(() => {
    setShovelId(null);
    setShowShovelIntro(false);
    setShovelDigging(false);
    setShovelFloats([]);
    setManageBuildingId((id) => {
      const b = me?.buildings.find((x) => x.id === id);
      return b?.type === "shovel" ? null : id;
    });
  }, [me?.buildings]);

  // Close digger if the shovel was razed / lost (poll or local patch)
  useEffect(() => {
    if (!shovelId || !me) return;
    const still = me.buildings.some(
      (b) => b.id === shovelId && b.type === "shovel" && (b.hp ?? 0) > 0
    );
    if (!still) closeShovel();
  }, [shovelId, me, closeShovel]);

  useEffect(() => {
    if (!manageBuildingId || !me) return;
    const still = me.buildings.some(
      (b) => b.id === manageBuildingId && (b.hp ?? 0) > 0
    );
    if (!still) {
      setManageBuildingId(null);
      if (shovelId === manageBuildingId) closeShovel();
    }
  }, [manageBuildingId, me, shovelId, closeShovel]);

  const managedBuilding = useMemo(() => {
    if (!manageBuildingId || !me) return null;
    return me.buildings.find((b) => b.id === manageBuildingId) ?? null;
  }, [manageBuildingId, me]);

  // HUD panels / sheets — open + close SFX
  const attackPanelOpen = Boolean(
    enemySelected && !placing && !needsHouseRebuild && !march
  );
  const razePanelOpen = Boolean(
    canRazeSelected && razeOwner && razeBuilding && !placing && !march
  );
  const managePanelOpen = Boolean(
    managedBuilding &&
      managedBuilding.type !== "shovel" &&
      !shovelId &&
      !placing
  );
  const shovelPanelOpen = Boolean(shovelId && !showShovelIntro);

  useEffect(() => {
    const bag = panelSfx.current;
    syncPanelOpenSfx(bag, "menu", showMenu);
    syncPanelOpenSfx(bag, "ranks", showRanks);
    syncPanelOpenSfx(bag, "battles", showBattles);
    syncPanelOpenSfx(bag, "missions", showMissions);
    syncPanelOpenSfx(bag, "invite", showInvite);
    syncPanelOpenSfx(bag, "analytics", showAnalytics);
    syncPanelOpenSfx(bag, "health", showHealth);
    syncPanelOpenSfx(bag, "walkthrough", showWalkthrough);
    syncPanelOpenSfx(bag, "activity", showActivity);
    syncPanelOpenSfx(bag, "sectorRename", showSectorRename);
    syncPanelOpenSfx(bag, "shovelIntro", showShovelIntro);
    syncPanelOpenSfx(bag, "shovel", shovelPanelOpen);
    syncPanelOpenSfx(bag, "manage", managePanelOpen);
    syncPanelOpenSfx(bag, "attack", attackPanelOpen);
    syncPanelOpenSfx(bag, "raze", razePanelOpen);
    syncPanelOpenSfx(bag, "review", Boolean(reviewBiz));
    syncPanelOpenSfx(bag, "saving", Boolean(savingLabel));
    syncPanelOpenSfx(bag, "npcPlace", Boolean(npcPlacing));
  }, [
    showMenu,
    showRanks,
    showBattles,
    showMissions,
    showInvite,
    showAnalytics,
    showHealth,
    showWalkthrough,
    showActivity,
    showSectorRename,
    showShovelIntro,
    shovelPanelOpen,
    managePanelOpen,
    attackPanelOpen,
    razePanelOpen,
    reviewBiz,
    savingLabel,
    npcPlacing,
  ]);

  const upgradeManagedBuilding = async () => {
    if (!managedBuilding || !me) return;
    const cost = buildingUpgradeCost(managedBuilding.type);
    if (buildingLevel(managedBuilding) >= BUILDING_MAX_LEVEL) {
      setError("Already upgraded to ×2");
      window.setTimeout(() => setError(null), 2800);
      return;
    }
    if (displayGold < cost) {
      setError(`Need ${formatGold(cost)} to upgrade`);
      window.setTimeout(() => setError(null), 3200);
      return;
    }
    const data = await act("upgrade_building", {
      buildingId: managedBuilding.id,
    });
    if (!data) return;
    playBuildSound();
    showToast(`${catalogItem(managedBuilding.type).name} upgraded to ×2`);
  };

  const demolishManagedBuilding = async () => {
    if (!managedBuilding || !me) return;
    const name = catalogItem(managedBuilding.type).name;
    const id = managedBuilding.id;
    const data = await act("demolish_building", { buildingId: id });
    if (!data) return;
    if (shovelId === id) closeShovel();
    setManageBuildingId(null);
    showToast(`Deleted your ${name}`);
  };

  /** Optimistic dig — syncs in background without blocking the UI */
  const digShovel = () => {
    if (!shovelId || !me || busyRef.current) return;
    const stillMine = me.buildings.find(
      (b) => b.id === shovelId && b.type === "shovel" && (b.hp ?? 0) > 0
    );
    if (!stillMine) {
      closeShovel();
      setError("Shovel missing — place another one");
      window.setTimeout(() => setError(null), 3200);
      return;
    }

    const gained = shovelDigYield(stillMine);
    setDisplayGold((g) => g + gained);
    setSnap((prev) => {
      if (!prev?.me) return prev;
      const nextMe: Player = {
        ...prev.me,
        gold: prev.me.gold + gained,
        totalFarmed: (prev.me.totalFarmed || 0) + gained,
        // Keep server updatedAt — optimistic digs must not block raze sync
        updatedAt: prev.me.updatedAt,
      };
      lastGoodMe.current = nextMe;
      return {
        ...prev,
        me: nextMe,
        players: prev.players.map((p) =>
          p.id === nextMe.id
            ? {
                ...p,
                gold: nextMe.gold,
                totalFarmed: nextMe.totalFarmed,
              }
            : p
        ),
      };
    });

    playCoinSound();
    setShovelDigging(true);
    window.setTimeout(() => setShovelDigging(false), 180);
    const fid = ++shovelFloatSeq.current;
    const x = 36 + Math.random() * 28;
    setShovelFloats((list) => [...list.slice(-8), { id: fid, x, amount: gained }]);
    window.setTimeout(() => {
      setShovelFloats((list) => list.filter((f) => f.id !== fid));
    }, 700);

    const buildingId = shovelId;
    void fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "click_shovel", buildingId }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // Roll back the optimistic dig
          setDisplayGold((g) => Math.max(0, g - gained));
          setSnap((prev) => {
            if (!prev?.me) return prev;
            const nextMe: Player = {
              ...prev.me,
              gold: Math.max(0, prev.me.gold - gained),
              totalFarmed: Math.max(0, (prev.me.totalFarmed || 0) - gained),
            };
            return {
              ...prev,
              me: nextMe,
              players: prev.players.map((p) =>
                p.id === nextMe.id
                  ? {
                      ...p,
                      gold: nextMe.gold,
                      totalFarmed: nextMe.totalFarmed,
                    }
                  : p
              ),
            };
          });
          const err = String(data?.error || "");
          if (
            /shovel|destroyed|missing/i.test(err) &&
            shovelIdRef.current === buildingId
          ) {
            closeShovel();
          }
          if (err) {
            setError(err);
            window.setTimeout(() => setError(null), 3200);
          }
          return;
        }
        // Soft-sync gold if the server is ahead (accrued gather, etc.)
        const serverGold =
          typeof (data as { gold?: number })?.gold === "number"
            ? (data as { gold: number }).gold
            : (data as GameSnapshot)?.me?.gold;
        if (typeof serverGold === "number") {
          setDisplayGold((g) => Math.max(g, serverGold));
        }
      })
      .catch(() => {
        /* keep optimistic gold — next poll will reconcile */
      });
  };

  // Google auth required — gate the game until signed in
  if (snap && !snap.authDisabled && !me) {
    return <EntryGate mode="signin" callbackUrl={inviteCallbackUrl()} />;
  }

  const shareInvite = async () => {
    if (!inviteLink) return;
    const text = `Join my sector in Islamabad Territorial Wars — use my invite and I get +${INVITE_VILLAGER_BONUS} villager:`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Islamabad Territorial Wars",
          text,
          url: inviteLink,
        });
        showToast("Invite shared");
        return;
      }
    } catch {
      /* fall through to clipboard */
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      showToast("Invite link copied — friend joins, you gain +1 villager");
    } catch {
      showToast(inviteLink);
    }
  };

  const openWalkthrough = () => {
    setShowMenu(false);
    setShowMissions(false);
    setShowInvite(false);
    setShowBattles(false);
    setShowRanks(false);
    if (!claimed) {
      showToast("Settle first — tips open after your village is live");
      return;
    }
    setShowWalkthrough(true);
  };

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[var(--surface)]">
      {/* Full-bleed map (clips here so HUD never gets cut) */}
      <div className="absolute inset-0 overflow-hidden">
        <GameMap
          sectors={snap?.sectors ?? []}
          spots={snap?.spots ?? []}
          me={me}
          players={snap?.players ?? []}
          events={snap?.events ?? []}
          worldNpcs={snap?.worldNpcs ?? []}
          selectedId={selectedId}
          selectedPlayerId={selectedPlayerId}
          placing={placing}
          previewHouse={pendingHouse}
          userLocation={!claimed ? liveLocation : null}
          userLocationFocus={locationFocus}
          sectorFocus={sectorFocus}
          homeFocus={homeFocus}
          march={march}
          impact={impact}
          onSelect={(id) => {
            setSelectedId(id);
            // Sector taps never open attack UI — only houses do
            setSelectedPlayerId(null);
            setRazeTarget(null);
          }}
          onSelectPlayer={(id) => {
            setRazeTarget(null);
            setShovelId(null);
            if (!id) {
              setSelectedPlayerId(null);
              return;
            }
            const target = snap?.players.find((p) => p.id === id);
            if (
              target?.homeSectorId &&
              me?.homeSectorId &&
              target.homeSectorId === me.homeSectorId
            ) {
              setSelectedPlayerId(null);
              showToast(
                "Same sector — rocket their building to clear ground for yours"
              );
              return;
            }
            setSelectedPlayerId(id);
          }}
          onSelectRaze={(target) => {
            setSelectedPlayerId(null);
            setRazeTarget(target);
            setShovelId(null);
          }}
          onSelectShovel={openShovel}
          onSelectOwnBuilding={openOwnBuilding}
          selectedRazeBuildingId={razeTarget?.buildingId ?? null}
          onPlace={(lat, lng) => void handlePlace(lat, lng)}
          onPlaceBlocked={flashPlaceBlocked}
          onSpawnFind={(p) => spawnFind(p)}
          onCollectHidden={(spotId) => void claimHidden(spotId)}
          claimingSpotIds={claimingSpotIds}
          onSelectBusiness={(biz) => {
            setReviewBiz(biz);
            setReviewOpenedAt(null);
            setReviewReady(false);
            setSelectedPlayerId(null);
            setRazeTarget(null);
          }}
          pinDropActive={(pickingPin || manualMode) && !claimed && !placing}
          pinDraggable={manualMode && !claimed && !placing && Boolean(liveLocation)}
          freePlaceActive={Boolean(npcPlacing) && !placing}
          onFreePlace={(lat, lng) => {
            if (!npcPlacing) return;
            void handleNpcPlace(lat, lng);
          }}
          onSelectNpc={(npc) => {
            void handleSelectNpc(npc);
          }}
          onDropPin={(lat, lng) => {
            const forceAzad = pinDropAzad.current;
            pinDropAzad.current = false;
            lockLocation(lat, lng, {
              forceAzad: forceAzad || undefined,
              keepManual: true,
            });
          }}
          onMovePin={(lat, lng) =>
            lockLocation(lat, lng, { keepManual: true, quiet: true })
          }
          onIntroComplete={() => {
            /* Location setup is self-guided; tips open after settle */
          }}
          guidePulse={
            Boolean(settleSector) &&
            (placing?.kind === "house" || placing?.kind === "villager")
          }
          syncingBuildingIds={syncingBuildIds}
          presencePeers={presencePeers}
          presenceSelf={
            selfCamera && visitorId
              ? {
                  id: visitorId,
                  name: displayName || me?.name || "You",
                  lat: selfCamera.lat,
                  lng: selfCamera.lng,
                  bubble: selfBubble?.text ?? null,
                  bubbleAt: selfBubble?.at ?? null,
                }
              : null
          }
          onCameraReport={reportCamera}
          className="h-full w-full"
        />
      </div>

      {/* ---- Top bar: one compact row on mobile, board below ---- */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex flex-col items-stretch gap-1.5 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-3 sm:pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex min-w-0 flex-nowrap items-center justify-between gap-1 sm:gap-2">
          <div className="pointer-events-auto flex min-w-0 shrink items-center gap-1 sm:gap-1.5">
            <Link
              href="/"
              className="hud-chip max-w-[9.5rem] truncate px-2 py-1.5 sm:max-w-none sm:px-3"
              title="Islamabad Territorial Wars"
            >
              <span className="font-display text-xs text-[var(--ink)] sm:text-sm">
                ITW
              </span>
              <span className="ml-1 font-mono text-[8px] uppercase tracking-[0.14em] text-[var(--ink-faint)] sm:ml-1.5 sm:tracking-[0.18em]">
                {claimed ? homeName : "settle"}
              </span>
            </Link>
            {claimed && (
              <button
                type="button"
                onClick={() => setHomeFocus((n) => n + 1)}
                className="hud-chip flex h-[30px] w-[30px] shrink-0 items-center justify-center p-0"
                title="Back to home"
                aria-label="Back to home"
              >
                <HouseSprite className="h-4 w-5" />
              </button>
            )}
          </div>

          <div className="pointer-events-auto flex shrink-0 flex-nowrap items-center gap-1 sm:gap-1.5">
            <div
              className="flex h-[30px] items-center gap-0.5 px-0.5 font-mono text-[10px] font-bold text-[#e8cf8a] sm:gap-1 sm:text-[11px]"
              title={claimed ? `${Math.floor(displayGold)} gold · +${perTrip}/trip` : `${Math.floor(displayGold)} gold`}
            >
              <GoldCoinIcon size={14} />
              <span className="leading-none tabular-nums">
                {Math.floor(displayGold)}
              </span>
            </div>
            <button
              type="button"
              data-nohover="1"
              onClick={() => setMusicOn(toggleMusic())}
              className={`hud-chip flex h-[30px] w-[30px] items-center justify-center p-0 font-mono text-[11px] sm:h-auto sm:w-auto sm:px-3 sm:py-1.5 ${
                musicOn
                  ? "text-[var(--sand)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--sand)]"
              }`}
              title={musicOn ? "Music on — tap to mute" : "Music off — tap to play"}
            >
              ♫
            </button>
            {me && (
              <button
                type="button"
                onClick={() => {
                  setShowInvite((v) => !v);
                  setShowMenu(false);
                  setShowBattles(false);
                  setShowRanks(false);
                  setShowMissions(false);
                }}
                className={`hud-chip inline-flex h-[30px] items-center gap-0.5 px-1.5 font-mono text-[10px] sm:h-auto sm:gap-1 sm:px-2.5 sm:py-1.5 sm:text-[11px] ${
                  showInvite
                    ? "text-[var(--sand)]"
                    : "text-[var(--ink-muted)] hover:text-[var(--sand)]"
                }`}
                title={`Invite friends — +${INVITE_VILLAGER_BONUS} villager each`}
              >
                <span className="hidden sm:inline">Invite</span>
                <span className="sm:hidden">Inv</span>
                <span className="font-bold text-[var(--sand)]">
                  +{INVITE_VILLAGER_BONUS}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setShowMenu((v) => !v);
                setShowBattles(false);
                setShowRanks(false);
                setShowMissions(false);
                setShowInvite(false);
              }}
              className={`hud-chip inline-flex h-[30px] items-center gap-1 px-2 font-mono text-[11px] sm:h-auto sm:gap-1.5 sm:px-3 sm:py-1.5 ${
                showMenu
                  ? "text-[var(--sand)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--sand)]"
              }`}
              title={`Menu · ${healthLabel(combinedHealthLevel)}`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${healthDotClass(combinedHealthLevel)}`}
                aria-hidden
              />
              ☰
            </button>
          </div>
        </div>

        <div
          className={`flex items-start gap-2 ${
            killFeed.length > 0 ? "justify-between" : "justify-end"
          }`}
        >
          {/* Killfeed sits under ITW/home — never overlaps the top chips */}
          {killFeed.length > 0 && (
            <div
              className="kill-feed pointer-events-none flex min-w-0 flex-col items-stretch gap-1"
              aria-live="polite"
            >
              {killFeed.map((item) => {
                const age = killFeedNow - item.shownAt;
                const fading = age >= KILL_FEED_TTL_MS - KILL_FEED_FADE_MS;
                return (
                  <div
                    key={item.id}
                    className={`kill-feed-line ${fading ? "is-fading" : ""}`}
                  >
                    {killFeedLine(item.event, me?.id, playerColors)}
                  </div>
                );
              })}
            </div>
          )}

          {/* Minimal leaderboard — sectors or Azad Umeed players */}
          <div className="sector-board pointer-events-auto w-[9.5rem] shrink-0 px-1.5 py-1.5 text-left sm:w-44">
            <div className="mb-1 flex flex-col gap-1">
              <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-white/55">
                {isAzadPlayer || azadMode ? "Azad Umeed" : "Top sectors"}
              </span>
              <div className="flex items-stretch gap-1">
                <button
                  type="button"
                  onClick={() =>
                    openSectorAnalytics(
                      selectedId && !isAzadHomeId(selectedId)
                        ? selectedId
                        : me?.homeSectorId && !isAzadHomeId(me.homeSectorId)
                          ? me.homeSectorId
                          : sectorRanking[0]?.id
                    )
                  }
                  className="hud-chip min-h-[32px] flex-1 px-1.5 py-1.5 font-mono text-[10px] font-semibold leading-none text-white/75 hover:text-white"
                  title="Sector analytics charts"
                >
                  Charts
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowRanks(true);
                    setShowMenu(false);
                    setShowBattles(false);
                    setShowMissions(false);
                    setShowInvite(false);
                  }}
                  className="hud-chip min-h-[32px] flex-1 px-1.5 py-1.5 font-mono text-[10px] font-semibold leading-none text-white/75 hover:text-white"
                  title="Open full leaderboard"
                >
                  All
                </button>
              </div>
            </div>
            {sectorBoard.length === 0 ? (
              <p className="text-[9px] text-white/45">No farms yet</p>
            ) : (
              <ol className="space-y-px">
                {sectorBoard.map((r) => {
                  const medal =
                    r.rank === 1
                      ? "medal-gold"
                      : r.rank === 2
                        ? "medal-silver"
                        : r.rank === 3
                          ? "medal-bronze"
                          : "";
                  return (
                    <li key={`${r.id}-${r.rank}`}>
                      <button
                        type="button"
                        onClick={() => {
                          if (r.azad) {
                            if (r.house) {
                              setLiveLocation(r.house);
                              setLocationFocus((n) => n + 1);
                            }
                            setSelectedPlayerId(r.id);
                          } else {
                            setSelectedId(r.id);
                            setSectorFocus((n) => n + 1);
                            setSelectedPlayerId(null);
                          }
                          setRazeTarget(null);
                          setShowRanks(false);
                        }}
                        className={`sector-board-row w-full ${medal} ${
                          r.mine ? "is-mine" : ""
                        } ${
                          r.azad
                            ? selectedPlayerId === r.id
                              ? "is-selected"
                              : ""
                            : selectedId === r.id
                              ? "is-selected"
                              : ""
                        }`}
                        title={`Fly to ${r.name}`}
                      >
                        <span
                          className="sector-board-rank"
                          title={r.rank === 1 ? "Top" : undefined}
                        >
                          {r.rank === 1 ? "👑" : r.rank}
                        </span>
                        <span className="sector-board-name">{r.name}</span>
                        <span className="sector-board-score">
                          {GOLD_COIN} {r.farmed}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      </div>

      {/* Menu dropdown — battles / goals / editor / account */}
      {showMenu && (
        <div className="absolute right-2 top-[4.75rem] z-30 w-56 hud-panel p-2 sm:right-3 sm:top-16">
          <div className="mb-1 flex items-center justify-between rounded-sm px-2 py-1.5">
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ink-muted)]">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--field-bright)]"
                aria-hidden
              />
              Online now
            </span>
            <span className="font-mono text-[11px] font-semibold tabular-nums text-[var(--sand)]">
              {onlineViewers ?? 1 + presencePeers.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowMenu(false);
              setShowBattles(true);
            }}
            className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-[12px] text-[var(--ink-muted)] hover:bg-[var(--wash)] hover:text-[var(--sand)]"
          >
            <span>⚔ Battle reports</span>
            <span className="font-mono text-[10px] text-[var(--ink-faint)]">
              {(snap?.events ?? []).length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setShowMenu(false);
              setShowActivity(true);
              setActivityTab("global");
            }}
            className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-[12px] text-[var(--ink-muted)] hover:bg-[var(--wash)] hover:text-[var(--sand)]"
          >
            <span>▤ Activity log</span>
            <span className="font-mono text-[10px] text-[var(--ink-faint)]">
              {(snap?.globalEvents ?? snap?.events ?? []).length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setShowMenu(false);
              setShowMissions(true);
            }}
            className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-[12px] text-[var(--ink-muted)] hover:bg-[var(--wash)] hover:text-[var(--sand)]"
          >
            <span>◈ Goals</span>
            <span className="font-mono text-[10px] text-[var(--ink-faint)]">
              {missionsDone}/{missionList.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() =>
              openSectorAnalytics(
                selectedId && !isAzadHomeId(selectedId)
                  ? selectedId
                  : me?.homeSectorId && !isAzadHomeId(me.homeSectorId)
                    ? me.homeSectorId
                    : sectorRanking[0]?.id
              )
            }
            className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-[12px] text-[var(--ink-muted)] hover:bg-[var(--wash)] hover:text-[var(--sand)]"
          >
            <span>▣ Sector charts</span>
            <span className="font-mono text-[10px] text-[var(--ink-faint)]">
              {sectorAnalyticsRows.length}
            </span>
          </button>
          {(snap?.isAdmin || snap?.authDisabled) && (
            <Link
              href="/manage"
              className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-[12px] text-[var(--ink-muted)] hover:bg-[var(--wash)] hover:text-[var(--sand)]"
              onClick={() => setShowMenu(false)}
            >
              <span>▦ Manage analytics</span>
              <span className="font-mono text-[10px] text-[var(--ink-faint)]">
                admin
              </span>
            </Link>
          )}
          {(snap?.isAdmin || snap?.authDisabled) && (
            <>
              <button
                type="button"
                onClick={() => {
                  setShowMenu(false);
                  setPlacing(null);
                  setNpcPlacing("cda_hq");
                  showToast("Tap the map to place CDA Head Office");
                }}
                className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-[12px] text-[var(--ink-muted)] hover:bg-[var(--wash)] hover:text-[var(--sand)]"
              >
                <span className="inline-flex items-center gap-1.5">
                  <CdaHqSprite className="h-5 w-6" />
                  Place CDA HQ
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMenu(false);
                  playNpcEngageSound();
                  void act(
                    "admin_dispatch_cda_truck",
                    {},
                    "Dispatching raid truck…"
                  ).then((d) => {
                    if (!d) return; // act already surfaced the error
                    const name =
                      typeof (d as { targetName?: string }).targetName ===
                      "string"
                        ? (d as { targetName: string }).targetName
                        : "a settler";
                    showToast(`CDA Raid Truck en route to ${name}`);
                  });
                }}
                className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-[12px] text-[var(--ink-muted)] hover:bg-[var(--wash)] hover:text-[var(--sand)]"
              >
                <span className="inline-flex items-center gap-1.5">
                  <CdaTruckSprite className="h-5 w-7" />
                  Dispatch raid truck
                </span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setShowMenu(false);
              setShowHealth(true);
              void probeServerHealth();
            }}
            className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-[12px] text-[var(--ink-muted)] hover:bg-[var(--wash)] hover:text-[var(--sand)]"
          >
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${healthDotClass(combinedHealthLevel)}`}
                aria-hidden
              />
              Health
            </span>
            <span className="font-mono text-[10px] text-[var(--ink-faint)]">
              {healthLabel(combinedHealthLevel)}
            </span>
          </button>
          <button
            type="button"
            onClick={openWalkthrough}
            className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-[12px] text-[var(--ink-muted)] hover:bg-[var(--wash)] hover:text-[var(--sand)]"
          >
            <span>? How to play</span>
          </button>
          {me && (
            <button
              type="button"
              onClick={() => {
                setShowMenu(false);
                setShowInvite(true);
              }}
              className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-[12px] text-[var(--ink-muted)] hover:bg-[var(--wash)] hover:text-[var(--sand)]"
            >
              <span>Invite a friend</span>
              <span className="font-mono text-[9px] text-[var(--ink-faint)]">
                +{INVITE_VILLAGER_BONUS} villager
              </span>
            </button>
          )}
          <div className="mt-1 border-t border-[var(--line)] pt-2">
            {me && !snap?.authDisabled ? (
              <div className="flex items-center justify-between px-2">
                <span className="max-w-[8rem] truncate font-mono text-[10px] text-[var(--sand)]">
                  {me.name}
                </span>
                <button
                  type="button"
                  className="font-mono text-[10px] text-[var(--ink-muted)] hover:text-[var(--signal-bright)]"
                  onClick={() => void signOut({ callbackUrl: "/play" })}
                >
                  Sign out
                </button>
              </div>
            ) : !me && !snap?.authDisabled ? (
              <Link
                href="/login"
                className="block px-2 font-mono text-[11px] text-[var(--sand)]"
                onClick={() => setShowMenu(false)}
              >
                Sign in
              </Link>
            ) : (
              <p className="px-2 font-mono text-[10px] text-[var(--ink-faint)]">
                {me?.name}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Recent battles log */}
      {showBattles && (
        <div className="absolute right-2 top-[4.75rem] z-30 w-80 max-w-[calc(100%-1rem)] hud-panel p-3 sm:right-3 sm:top-16">
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              Battle reports
            </h2>
            <button
              type="button"
              onClick={() => setShowBattles(false)}
              className="font-mono text-[11px] text-[var(--ink-faint)] hover:text-[var(--sand)]"
            >
              ✕
            </button>
          </div>
          {(snap?.events ?? []).filter(isAttackEvent).length === 0 ? (
            <p className="mt-2 text-[11px] text-[var(--ink-faint)]">
              No attacks yet. Raid a rival sector to see a report here.
            </p>
          ) : (
            <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
              {[...(snap?.events ?? [])]
                .filter(isAttackEvent)
                .reverse()
                .map((e) => (
                <li
                  key={e.id}
                  className="rounded-sm border border-[var(--line)] px-2 py-1.5 text-[11px] text-[var(--ink-muted)]"
                >
                  <p className="font-semibold text-[var(--ink)]">
                    {eventLogLine(e, me?.id, playerColors)}
                  </p>
                  <p className="mt-0.5 font-mono text-[9px] text-[var(--ink-faint)]">
                    {timeAgo(e.ts, relativeNow)}
                    {e.destroyed ? ` · destroyed ${e.destroyed}` : ""}
                    {e.lootedGold > 0
                      ? ` · ${GOLD_COIN}${e.lootedGold} loot`
                      : ""}
                  </p>
                  <button
                    type="button"
                    className="mt-1 text-[9px] font-bold text-[var(--sand)]"
                    onClick={() => {
                      const summary = summaryFromEvent(
                        e,
                        e.defenderId === me?.id
                      );
                      if (summary) {
                        setBattleSummary(summary);
                        setShowBattles(false);
                      }
                    }}
                  >
                    Open report
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showAnalytics && (
        <SectorAnalyticsModal
          rows={sectorAnalyticsRows}
          initialSectorId={analyticsSectorId}
          onClose={() => setShowAnalytics(false)}
          onFlyTo={(id) => {
            setSelectedId(id);
            setSectorFocus((n) => n + 1);
            setSelectedPlayerId(null);
            setRazeTarget(null);
            setShowAnalytics(false);
          }}
        />
      )}

      {showHealth && (
        <HealthPanel
          client={clientHealth}
          server={serverHealth}
          serverLoading={serverHealthLoading}
          onRefresh={() => void probeServerHealth()}
          onClose={() => setShowHealth(false)}
        />
      )}

      {/* Top scorer — name your sector (code + custom tag) */}
      {showSectorRename && homeSectorRecord && canRenameHomeSector && (
        <div
          className="absolute inset-0 z-[45] flex items-end justify-center bg-black/55 p-3 sm:items-center"
          onClick={() => setShowSectorRename(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowSectorRename(false);
          }}
          role="presentation"
        >
          <div
            className="hud-panel w-full max-w-sm p-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Rename sector"
          >
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--sand)]">
              Sector crown
            </p>
            <h2 className="mt-1 font-display text-xl text-[var(--ink)]">
              Name your sector
            </h2>
            <p className="mt-1 text-[12px] text-[var(--ink-muted)]">
              You&apos;re the top scorer in{" "}
              <strong className="text-[var(--ink)]">
                {sectorBaseCode(homeSectorRecord)}
              </strong>
              . Add a title — it shows as{" "}
              <span className="text-[var(--sand)]">
                {sectorBaseCode(homeSectorRecord)}
                {sectorTagDraft.trim()
                  ? ` ${sectorTagDraft.trim()}`
                  : " …"}
              </span>
              .
            </p>
            <label className="mt-3 block">
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">
                Your title
              </span>
              <div className="mt-1 flex items-center gap-1.5 rounded-sm border border-[var(--line)] bg-[var(--wash)] px-2.5 py-2">
                <span className="shrink-0 font-mono text-[12px] font-bold text-[var(--ink-muted)]">
                  {sectorBaseCode(homeSectorRecord)}
                </span>
                <input
                  value={sectorTagDraft}
                  onChange={(e) => setSectorTagDraft(e.target.value)}
                  maxLength={28}
                  placeholder="e.g. Empire"
                  className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
                  autoFocus
                />
              </div>
            </label>
            <p className="mt-2 font-mono text-[10px] text-[var(--ink-faint)]">
              Preview:{" "}
              <span className="text-[var(--sand)]">
                {sectorBaseCode(homeSectorRecord)}
                {sectorTagDraft.trim() ? ` ${sectorTagDraft.trim()}` : ""}
              </span>
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setShowSectorRename(false)}
                className="flex-1 rounded-sm border border-[var(--line)] px-3 py-2.5 text-sm text-[var(--ink-muted)] hover:border-[var(--sand)] hover:text-[var(--sand)]"
              >
                Later
              </button>
              <button
                type="button"
                disabled={sectorRenameSaving || busy}
                onClick={() => void saveSectorRename()}
                className="flex-1 rounded-sm bg-[var(--signal)] px-3 py-2.5 text-sm font-bold text-white disabled:opacity-40"
              >
                {sectorRenameSaving ? "Saving…" : "Save name"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full leaderboard modal — sectors + Azad Umeed */}
      {showRanks && (
        <div
          className="absolute inset-0 z-40 flex items-end justify-center bg-black/50 p-3 sm:items-center"
          onClick={() => setShowRanks(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowRanks(false);
          }}
          role="presentation"
        >
          <div
            className="hud-panel max-h-[min(80dvh,36rem)] w-full max-w-md overflow-hidden p-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Leaderboard"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl text-[var(--ink)]">
                  Leaderboard
                </h2>
                <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                  Total resources farmed
                </p>
                <p className="mt-1.5 max-w-[16rem] font-mono text-[9px] leading-snug text-[var(--sand)]/85">
                  {flexUnlocked
                    ? "You’re #1 — Civic, Prado & Cruiser are in Arsenal."
                    : "Be #1 in your sector to unlock Civic, Prado & Cruiser."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openSectorAnalytics(selectedId)}
                  className="rounded-sm border border-[var(--line)] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--sand)] hover:border-[var(--sand)]"
                  title="Open sector analytics charts"
                >
                  Charts
                </button>
                <button
                  type="button"
                  onClick={() => setShowRanks(false)}
                  className="font-mono text-[14px] text-[var(--ink-faint)] hover:text-[var(--sand)]"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="mt-3 max-h-[min(60dvh,28rem)] space-y-4 overflow-y-auto pr-1">
              <section>
                <h3 className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                  Sectors
                </h3>
                <ol className="space-y-1.5">
                  {sectorRanking.length === 0 && (
                    <li className="text-[12px] text-[var(--ink-faint)]">
                      No sectors yet
                    </li>
                  )}
                  {sectorRanking.map((r, i) => {
                    const mine = me?.homeSectorId === r.id;
                    const canRenameHere = mine && canRenameHomeSector;
                    return (
                      <li key={r.id} className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedId(r.id);
                            setSectorFocus((n) => n + 1);
                            setSelectedPlayerId(null);
                            setRazeTarget(null);
                            setShowRanks(false);
                          }}
                          className={`flex min-w-0 flex-1 items-center justify-between rounded-sm border px-2.5 py-2 text-left text-[12px] transition hover:border-[var(--sand)] hover:bg-[var(--wash)] ${
                            mine
                              ? "border-[var(--sand)] bg-[var(--wash)] text-[var(--sand)]"
                              : "border-[var(--line)] text-[var(--ink-muted)]"
                          }`}
                          title={`Fly to ${r.name}`}
                        >
                          <span className="min-w-0">
                            <span className="font-mono text-[var(--ink-faint)]">
                              {i === 0
                                ? "👑"
                                : i === 1
                                  ? "🥈"
                                  : i === 2
                                    ? "🥉"
                                    : `${i + 1}.`}
                            </span>{" "}
                            <strong className="text-[var(--ink)]">{r.name}</strong>
                            <span className="ml-1.5 font-mono text-[9px] text-[var(--ink-faint)]">
                              {r.settlers} settler{r.settlers === 1 ? "" : "s"}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono font-semibold text-[#e8cf8a]">
                            {GOLD_COIN} {formatGoldCompact(r.farmed)}
                          </span>
                        </button>
                        {canRenameHere && (
                          <button
                            type="button"
                            onClick={openSectorRename}
                            className="shrink-0 rounded-sm border border-[var(--sand)] px-2 py-2 font-mono text-[10px] text-[var(--sand)] hover:bg-[var(--wash)]"
                            title="Rename your sector"
                            aria-label="Rename your sector"
                          >
                            ✎
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openSectorAnalytics(r.id)}
                          className="shrink-0 rounded-sm border border-[var(--line)] px-2 py-2 font-mono text-[10px] text-[var(--ink-muted)] hover:border-[var(--sand)] hover:text-[var(--sand)]"
                          title={`Analytics for ${r.name}`}
                          aria-label={`Analytics for ${r.name}`}
                        >
                          ▣
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>

              <section>
                <h3 className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                  {AZAD_ARENA_NAME}
                </h3>
                <p className="mb-1.5 text-[10px] text-[var(--ink-muted)]">
                  Off-map players · no sector walls · ranked individually
                </p>
                <ol className="space-y-1.5">
                  {azadRanking.length === 0 && (
                    <li className="text-[12px] text-[var(--ink-faint)]">
                      No Azad settlers yet
                    </li>
                  )}
                  {azadRanking.map((r, i) => {
                    const mine = me?.id === r.id;
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => {
                            if (r.house) {
                              setLiveLocation(r.house);
                              setLocationFocus((n) => n + 1);
                            }
                            setSelectedPlayerId(r.id);
                            setRazeTarget(null);
                            setShowRanks(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-sm border px-2.5 py-2 text-left text-[12px] transition hover:border-[var(--sand)] hover:bg-[var(--wash)] ${
                            mine
                              ? "border-[var(--sand)] bg-[var(--wash)] text-[var(--sand)]"
                              : "border-[var(--line)] text-[var(--ink-muted)]"
                          }`}
                          title={`Fly to ${r.name}`}
                        >
                          <span className="min-w-0">
                            <span className="font-mono text-[var(--ink-faint)]">
                              {i === 0
                                ? "👑"
                                : i === 1
                                  ? "🥈"
                                  : i === 2
                                    ? "🥉"
                                    : `${i + 1}.`}
                            </span>{" "}
                            <strong className="text-[var(--ink)]">{r.name}</strong>
                          </span>
                          <span className="shrink-0 font-mono font-semibold text-[#e8cf8a]">
                            {GOLD_COIN} {r.farmed}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Goals dropdown */}
      {showMissions && (
        <div className="absolute right-2 top-[4.75rem] z-30 w-64 hud-panel p-3 sm:right-3 sm:top-16">
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              Starter goals
            </h2>
            <button
              type="button"
              onClick={() => setShowMissions(false)}
              className="font-mono text-[11px] text-[var(--ink-faint)] hover:text-[var(--sand)]"
            >
              ✕
            </button>
          </div>
          <ul className="mt-2 space-y-1.5">
            {missionList.map((m) => (
              <li
                key={m.id}
                className={`flex items-start gap-2 text-[11px] ${
                  m.done
                    ? "text-[var(--field-bright)]"
                    : "text-[var(--ink-muted)]"
                }`}
              >
                <span className="mt-0.5 font-mono">{m.done ? "✔" : "•"}</span>
                <span>{m.label}</span>
              </li>
            ))}
          </ul>
          {me && (
            <button
              type="button"
              className="mt-3 w-full rounded-sm border border-[var(--line-strong)] px-2 py-1.5 text-left font-mono text-[9px] text-[var(--sand)]"
              onClick={() => {
                setShowMissions(false);
                setShowInvite(true);
              }}
            >
              ◈ Invite a friend (+1 villager)
            </button>
          )}
        </div>
      )}

      {/* Invite friends panel */}
      {showInvite && me && (
        <div className="absolute right-2 top-[4.75rem] z-30 w-72 max-w-[calc(100%-1rem)] hud-panel p-3 sm:right-3 sm:top-16">
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              Invite friends
            </h2>
            <button
              type="button"
              onClick={() => setShowInvite(false)}
              className="font-mono text-[11px] text-[var(--ink-faint)] hover:text-[var(--sand)]"
            >
              ✕
            </button>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--ink-muted)]">
            Share your link. Each friend who joins with it gives you{" "}
            <span className="text-[var(--sand)]">
              +{INVITE_VILLAGER_BONUS} villager
            </span>{" "}
            — permanent gather power.
          </p>
          <p className="mt-2 font-mono text-[10px] text-[var(--ink-faint)]">
            Code{" "}
            <span className="text-[var(--sand)]">{me.inviteCode}</span>
            {" · "}
            {(snap?.inviteCount ?? 0) === 0
              ? "No referrals yet"
              : `${snap?.inviteCount} friend${
                  (snap?.inviteCount ?? 0) === 1 ? "" : "s"
                } joined`}
          </p>
          {inviteLink ? (
            <p className="mt-2 break-all rounded-sm bg-[var(--wash)] px-2 py-1.5 font-mono text-[9px] text-[var(--ink-muted)]">
              {inviteLink}
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-[var(--signal-bright)]">
              Sign in to get your invite link.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={!inviteLink}
              className="flex-1 rounded-sm bg-[var(--signal)] px-2 py-2 text-[12px] font-bold text-white disabled:opacity-40"
              onClick={() => void shareInvite()}
            >
              Share link
            </button>
            <button
              type="button"
              disabled={!inviteLink}
              className="rounded-sm border border-[var(--line-strong)] px-3 py-2 font-mono text-[10px] text-[var(--sand)] disabled:opacity-40"
              onClick={() => {
                if (!inviteLink) return;
                void navigator.clipboard.writeText(inviteLink).then(
                  () => showToast("Invite link copied"),
                  () => showToast(inviteLink)
                );
              }}
            >
              Copy
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-snug text-[var(--ink-faint)]">
            Friend opens the link → signs in with Google → you get +
            {INVITE_VILLAGER_BONUS} villager when their account is created.
          </p>
        </div>
      )}

      <Walkthrough
        open={showWalkthrough}
        onClose={() => setShowWalkthrough(false)}
        ctx={{
          claimed,
          gpsReady: Boolean(gpsFix),
          placingKind: placing?.kind ?? null,
          sectorName: azadMode || isAzadPlayer
            ? AZAD_ARENA_NAME
            : selected?.name ??
              (me?.homeSectorId
                ? snap?.sectors.find((s) => s.id === me.homeSectorId)?.name ??
                  null
                : null),
          offMap: azadMode || isAzadPlayer,
          azadMode: azadMode || isAzadPlayer,
        }}
      />

      {/* Battle report — corner toast, auto-dismisses */}
      {battleSummary && (
        <div
          className="battle-toast pointer-events-none absolute right-2 z-[60] w-[min(18.5rem,calc(100%-1rem))] sm:right-3"
          style={{
            top: "max(4.25rem, calc(env(safe-area-inset-top) + 3.5rem))",
          }}
          role="status"
          aria-live="polite"
          aria-label="Battle report"
        >
          <div
            className={`battle-report pointer-events-auto p-3.5 ${
              battleSummary.role === "defender"
                ? "battle-report-defense"
                : battleSummary.win
                  ? "battle-report-win"
                  : "battle-report-loss"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/65">
                  {battleSummary.role === "defender" ? "Under attack" : "Your raid"}
                  {" · "}
                  {battleSummary.sectorName}
                </p>
                <p className="font-display text-xl leading-tight text-white sm:text-2xl">
                  {battleSummary.headline}
                </p>
                <p className="mt-1 text-[12px] leading-snug text-white/90">
                  {battleSummary.detail}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-sm border border-white/30 px-2 py-0.5 text-[10px] font-bold text-white/90"
                onClick={dismissBattle}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>

            <div className="battle-vs mt-3">
              <div className="battle-vs-side">
                <span className="battle-vs-num">{battleSummary.attackPower}</span>
                <span className="battle-vs-lbl">ATK</span>
              </div>
              <div className="battle-vs-bar" aria-hidden>
                <span
                  className="battle-vs-fill is-atk"
                  style={{
                    width: `${Math.min(
                      100,
                      (battleSummary.attackPower /
                        Math.max(
                          1,
                          battleSummary.attackPower + battleSummary.defensePower
                        )) *
                        100
                    )}%`,
                  }}
                />
                <span
                  className="battle-vs-fill is-def"
                  style={{
                    width: `${Math.min(
                      100,
                      (battleSummary.defensePower /
                        Math.max(
                          1,
                          battleSummary.attackPower + battleSummary.defensePower
                        )) *
                        100
                    )}%`,
                  }}
                />
              </div>
              <div className="battle-vs-side">
                <span className="battle-vs-num">{battleSummary.defensePower}</span>
                <span className="battle-vs-lbl">DEF</span>
              </div>
            </div>

            <div className="battle-stat-grid mt-2.5">
              <div className="battle-stat">
                <span className="battle-stat-val">{battleSummary.damage}</span>
                <span className="battle-stat-lbl">Damage</span>
              </div>
              <div className="battle-stat">
                <span className="battle-stat-val">
                  {battleSummary.destroyedCount}
                </span>
                <span className="battle-stat-lbl">
                  {battleSummary.role === "attacker" ? "Destroyed" : "Lost"}
                </span>
              </div>
              <div className="battle-stat">
                <span className="battle-stat-val">
                  {battleSummary.role === "attacker"
                    ? `−${battleSummary.rocketsLost}`
                    : `−${battleSummary.defenderRocketsLost}`}
                </span>
                <span className="battle-stat-lbl">Rockets</span>
              </div>
              <div className="battle-stat">
                <span className="battle-stat-val">
                  {battleSummary.lootedGold > 0
                    ? `+${GOLD_COIN}${battleSummary.lootedGold}`
                    : `${GOLD_COIN}0`}
                </span>
                <span className="battle-stat-lbl">Gold</span>
              </div>
            </div>

            {(battleSummary.houseDestroyed || battleSummary.houseDamaged) && (
              <p className="mt-2.5 text-center font-mono text-[10px] text-white/85">
                {battleSummary.houseDestroyed
                  ? battleSummary.role === "attacker"
                    ? "Their base was razed — they must rebuild"
                    : "Your base was razed — rebuild to gather"
                  : battleSummary.role === "attacker"
                    ? "Their house was damaged"
                    : "Your base was damaged"}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Top loader while a gem/resource claim is writing to the server */}
      {claimingSpotIds.length > 0 && (
        <div
          className="claim-top-loader pointer-events-none absolute left-0 right-0 z-[55]"
          style={{ top: "max(0px, env(safe-area-inset-top))" }}
          role="status"
          aria-live="polite"
          aria-label="Claiming resource"
        >
          <div className="claim-top-loader-bar" />
          <p className="claim-top-loader-label">
            Claiming…
            {claimingSpotIds.length > 1 ? ` ×${claimingSpotIds.length}` : ""}
          </p>
        </div>
      )}

      {/* Saving settlement / build — never cover an active rocket flight */}
      {savingLabel && !march && (
        <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/35 px-4 pb-28 sm:items-center sm:pb-0">
          <div className="hud-panel w-full max-w-xs p-4 text-center">
            <p className="font-display text-lg text-[var(--sand)]">{savingLabel}</p>
            <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
              Planting your claim on the map — almost there…
            </p>
            <div className="mx-auto mt-3 h-1 w-32 overflow-hidden rounded-full bg-[var(--wash)]">
              <div className="h-full w-1/2 animate-pulse bg-[var(--sand)]" />
            </div>
          </div>
        </div>
      )}

      {/* Zoomed-in place tap → explain modal + Google review reward */}
      {reviewBiz && claimed && (
        <div
          className="absolute inset-0 z-[48] flex items-end justify-center bg-black/55 p-3 sm:items-center"
          onClick={() => {
            setReviewBiz(null);
            setReviewOpenedAt(null);
            setReviewReady(false);
          }}
          role="presentation"
        >
          <div
            className="hud-panel pointer-events-auto w-full max-w-sm p-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="You found a local business"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--sand)]">
                  You found a spot!
                </p>
                <h2 className="mt-1 font-display text-2xl leading-tight text-[var(--ink)]">
                  {reviewBiz.name}
                </h2>
                {reviewBiz.address && (
                  <p className="mt-1 line-clamp-2 text-[11px] text-[var(--ink-muted)]">
                    {reviewBiz.address}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setReviewBiz(null);
                  setReviewOpenedAt(null);
                  setReviewReady(false);
                }}
                className="shrink-0 font-mono text-[14px] text-[var(--ink-faint)] hover:text-[var(--sand)]"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-[var(--ink)]">
              You discovered a local business. Support it — leave a nice review
              and earn a{" "}
              <strong className="text-[var(--sand)]">
                bonus villager
              </strong>
              !
            </p>

            <ol className="mt-3 space-y-2 text-left text-[12px] text-[var(--ink-muted)]">
              <li className="flex gap-2">
                <span className="font-mono text-[var(--sand)]">1.</span>
                <span>Open it in Google Maps.</span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-[var(--sand)]">2.</span>
                <span>Leave a review (stars + a short note).</span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-[var(--sand)]">3.</span>
                <span>Come back and claim your villager!</span>
              </li>
            </ol>

            {me?.reviewedPlaceIds?.includes(reviewBiz.placeKey) ? (
              <p className="mt-4 rounded-sm border border-[var(--field)] bg-[var(--wash)] px-2.5 py-2 text-center text-[12px] text-[var(--field-bright)]">
                You already helped this place — nice!
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    window.open(
                      googleMapsReviewUrl(reviewBiz),
                      "_blank",
                      "noopener,noreferrer"
                    );
                    setReviewOpenedAt(Date.now());
                  }}
                  className="w-full rounded-sm bg-[var(--signal)] px-3 py-2.5 text-sm font-bold text-white"
                >
                  Open in Google Maps
                </button>
                <button
                  type="button"
                  disabled={busy || !reviewReady}
                  onClick={() => {
                    const biz = reviewBiz;
                    // Close right away so claim doesn't leave the modal stuck open
                    setReviewBiz(null);
                    setReviewOpenedAt(null);
                    setReviewReady(false);
                    void act("claim_business_review", {
                      placeKey: biz.placeKey,
                      placeName: biz.name,
                      lat: biz.lat,
                      lng: biz.lng,
                    }).then((d) => {
                      if (!d) return;
                      playRecruitSound();
                      showToast(
                        `Yay! +${REVIEW_VILLAGER_BONUS} bonus villager!`
                      );
                    });
                  }}
                  className="w-full rounded-sm border border-[var(--line-strong)] bg-[var(--wash)] px-3 py-2 text-xs font-semibold text-[var(--sand)] disabled:opacity-40"
                  title={
                    reviewOpenedAt == null
                      ? "Leave a review first, then claim"
                      : reviewReady
                        ? "Claim your bonus villager"
                        : "Finish your review, then come back"
                  }
                >
                  {reviewOpenedAt == null
                    ? "I left a review — give me my villager!"
                    : reviewReady
                      ? `Claim my +${REVIEW_VILLAGER_BONUS} villager`
                      : "Write your review… (~15s)"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* First-time shovel explain */}
      {showShovelIntro && shovelId && (
        <div className="absolute inset-0 z-[55] flex items-end justify-center bg-black/55 p-3 sm:items-center">
          <div
            className="hud-panel w-full max-w-sm p-4 text-center"
            role="dialog"
            aria-label="Clicker shovel"
          >
            <div className="mx-auto mb-2 flex justify-center">
              <ShovelSprite className="h-16 w-16" />
            </div>
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
              New building
            </p>
            <h2 className="mt-1 font-display text-2xl text-[var(--ink)]">
              Clicker shovel
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">
              Tap the shovel to dig.{" "}
              <strong className="text-[var(--sand)]">Each click gives gold</strong>
              — no wait, no trip. Upgrade it to ×2 digs, or delete it from the panel.
            </p>
            <button
              type="button"
              onClick={dismissShovelIntro}
              className="mt-4 w-full rounded-sm bg-[var(--signal)] px-3 py-2.5 text-sm font-bold text-white"
            >
              Got it — start digging
            </button>
          </div>
        </div>
      )}

      {/* Clicker shovel dig panel */}
      {shovelId && !showShovelIntro && (
        <div className="absolute inset-x-0 bottom-0 z-[50] flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none">
          <div
            className="shovel-panel pointer-events-auto hud-panel w-full max-w-sm p-3 text-center"
            role="dialog"
            aria-label="Dig for gold"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-left">
                <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                  Clicker shovel
                </p>
                <p className="font-display text-lg text-[var(--ink)]">
                  Dig for gold
                </p>
              </div>
              <button
                type="button"
                onClick={closeShovel}
                className="font-mono text-[14px] text-[var(--ink-faint)] hover:text-[var(--sand)]"
                aria-label="Close shovel"
              >
                ✕
              </button>
            </div>
            <p className="mt-0.5 text-left text-[11px] text-[var(--ink-muted)]">
              Each tap = +
              {managedBuilding && managedBuilding.type === "shovel"
                ? shovelDigYield(managedBuilding)
                : 1}{" "}
              <GoldCoinIcon size={11} className="inline-block align-[-2px]" />
              {managedBuilding && buildingLevel(managedBuilding) >= 2
                ? " · upgraded ×2"
                : ""}
            </p>
            <div className="relative mx-auto mt-2 flex h-36 w-full max-w-[14rem] items-center justify-center">
              {shovelFloats.map((f) => (
                <span
                  key={f.id}
                  className="shovel-float"
                  style={{ left: `${f.x}%` }}
                >
                  +{f.amount}
                </span>
              ))}
              <button
                type="button"
                data-nohover="1"
                onPointerDown={(e) => {
                  e.preventDefault();
                  digShovel();
                }}
                className={`shovel-dig-btn ${shovelDigging ? "is-digging" : ""}`}
                aria-label="Dig — gain one gold"
              >
                <ShovelSprite
                  digging={shovelDigging}
                  className="h-20 w-20 sm:h-24 sm:w-24"
                />
                <span className="shovel-dig-label">DIG</span>
              </button>
            </div>
            {managedBuilding && managedBuilding.type === "shovel" && (
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={
                    busy ||
                    buildingLevel(managedBuilding) >= BUILDING_MAX_LEVEL ||
                    displayGold < buildingUpgradeCost(managedBuilding.type)
                  }
                  onClick={() => void upgradeManagedBuilding()}
                  className="rounded-sm border border-[var(--line)] px-2 py-1.5 font-mono text-[10px] text-[var(--sand)] hover:border-[var(--sand)] disabled:opacity-40"
                  title={
                    buildingLevel(managedBuilding) >= BUILDING_MAX_LEVEL
                      ? "Already ×2"
                      : `Upgrade dig to ×2 for ${formatGold(buildingUpgradeCost(managedBuilding.type))}`
                  }
                >
                  {buildingLevel(managedBuilding) >= BUILDING_MAX_LEVEL
                    ? "Upgraded ×2"
                    : `Upgrade ×2 · ${formatGoldCompact(buildingUpgradeCost(managedBuilding.type))}`}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void demolishManagedBuilding()}
                  className="rounded-sm border border-[#6a3f3a] px-2 py-1.5 font-mono text-[10px] text-[#e88a7a] hover:border-[#e88a7a] disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Own building manage — upgrade / delete */}
      {managedBuilding &&
        managedBuilding.type !== "shovel" &&
        !shovelId &&
        !placing && (
          <div className="absolute inset-x-0 bottom-0 z-[50] flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none">
            <div
              className="pointer-events-auto hud-panel w-full max-w-sm p-3"
              role="dialog"
              aria-label="Manage building"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                    Your building
                  </p>
                  <p className="font-display text-lg text-[var(--ink)]">
                    {catalogItem(managedBuilding.type).name}
                    {buildingLevel(managedBuilding) >= 2 ? " · ×2" : ""}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
                    {catalogItem(managedBuilding.type).tripBonus > 0
                      ? `+${buildingTripBonus(managedBuilding)} gold / trip`
                      : catalogItem(managedBuilding.type).blurb}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setManageBuildingId(null)}
                  className="font-mono text-[14px] text-[var(--ink-faint)] hover:text-[var(--sand)]"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={
                    busy ||
                    buildingLevel(managedBuilding) >= BUILDING_MAX_LEVEL ||
                    displayGold < buildingUpgradeCost(managedBuilding.type)
                  }
                  onClick={() => void upgradeManagedBuilding()}
                  className="rounded-sm border border-[var(--line)] bg-[var(--wash)] px-2 py-2 font-mono text-[11px] text-[var(--sand)] hover:border-[var(--sand)] disabled:opacity-40"
                  title={
                    buildingLevel(managedBuilding) >= BUILDING_MAX_LEVEL
                      ? "Already upgraded"
                      : `Pay 10× build price for ×2 output`
                  }
                >
                  {buildingLevel(managedBuilding) >= BUILDING_MAX_LEVEL
                    ? "Upgraded ×2"
                    : `Upgrade ×2 · ${GOLD_COIN}${formatGoldCompact(buildingUpgradeCost(managedBuilding.type))}`}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void demolishManagedBuilding()}
                  className="rounded-sm border border-[#6a3f3a] px-2 py-2 font-mono text-[11px] text-[#e88a7a] hover:border-[#e88a7a] disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
              {buildingLevel(managedBuilding) < BUILDING_MAX_LEVEL && (
                <p className="mt-2 font-mono text-[9px] text-[var(--ink-faint)]">
                  Upgrade costs 10× build price and doubles output.
                </p>
              )}
            </div>
          </div>
        )}

      {/* Persistent NPC threat banners */}
      {(snap?.activeSpyThreats?.length || snap?.activeRaidTruck) && (
        <div className="pointer-events-none absolute inset-x-0 top-[4.5rem] z-[55] flex flex-col items-center gap-1.5 px-2 sm:top-[4.25rem]">
          {(snap?.activeSpyThreats ?? []).map((sat) => (
            <div
              key={sat.id}
              className="npc-threat-banner pointer-events-auto flex w-[min(22rem,calc(100%-1rem))] items-center gap-2 rounded-sm px-2.5 py-2"
            >
              <SpySatSprite className="h-9 w-9 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-[var(--signal-bright)]">
                  Spy satellite active
                </p>
                <p className="truncate text-[10px] text-[var(--ink-muted)]">
                  Planted by {sat.ownerName || "someone"} — draining your gold.
                  Zoom in to find &amp; smash it.
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-sm bg-[var(--signal)] px-2 py-1 text-[10px] font-bold text-white"
                onClick={() => void handleSelectNpc(sat)}
              >
                Smash
              </button>
            </div>
          ))}
          {snap?.activeRaidTruck && (
            <div className="npc-threat-banner pointer-events-auto flex w-[min(22rem,calc(100%-1rem))] items-center gap-2 rounded-sm px-2.5 py-2">
              <CdaTruckSprite className="h-8 w-10 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-[var(--signal-bright)]">
                  {snap.activeRaidTruck.targetPlayerId === me?.id
                    ? "CDA is raiding you"
                    : `CDA raiding ${
                        snap.activeRaidTruck.targetName || "a settler"
                      }`}
                </p>
                <p className="truncate text-[10px] text-[var(--ink-muted)]">
                  {snap.activeRaidTruck.phase === "parked"
                    ? snap.activeRaidTruck.targetPlayerId === me?.id
                      ? `Parked at your base — stolen ◈${
                          snap.activeRaidTruck.drainedTotal || 0
                        }. Chase it off!`
                      : `Parked at ${
                          snap.activeRaidTruck.targetName || "a settler"
                        }'s base — stolen ◈${
                          snap.activeRaidTruck.drainedTotal || 0
                        }`
                    : snap.activeRaidTruck.phase === "fleeing"
                      ? `Fleeing back to CDA HQ${
                          snap.activeRaidTruck.drainedTotal
                            ? ` · took ◈${snap.activeRaidTruck.drainedTotal}`
                            : ""
                        }`
                      : `En route to ${
                          snap.activeRaidTruck.targetName || "a settler"
                        }'s base`}
                </p>
              </div>
              {snap.activeRaidTruck.phase === "parked" &&
                snap.activeRaidTruck.targetPlayerId === me?.id && (
                <button
                  type="button"
                  className="shrink-0 rounded-sm bg-[var(--signal)] px-2 py-1 text-[10px] font-bold text-white"
                  onClick={() =>
                    void handleSelectNpc(snap.activeRaidTruck!)
                  }
                >
                  Chase off
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {npcPlacing && (
        <div className="absolute bottom-36 left-1/2 z-30 -translate-x-1/2 sm:bottom-8">
          <button
            type="button"
            onClick={() => setNpcPlacing(null)}
            className="hud-chip px-4 py-2 text-xs font-semibold text-[var(--signal-bright)]"
          >
            ✕ Cancel{" "}
            {npcPlacing === "cda_hq" ? "CDA HQ place" : "spy sat plant"}
          </button>
        </div>
      )}

      {/* Toast / error */}
      {(toast || error) && !battleSummary && !savingLabel && (
        <div className="pointer-events-none absolute left-1/2 top-14 z-40 -translate-x-1/2">
          <p
            className={`hud-chip px-4 py-2 text-xs font-semibold ${
              error ? "text-[var(--signal-bright)]" : "text-[var(--field-bright)]"
            }`}
          >
            {error || toast}
          </p>
        </div>
      )}

      {/* Building placement cancel (not settle house/villager — those use the dock) */}
      {placing && !savingLabel && !isSettlePlacing && (
        <div className="absolute bottom-36 left-1/2 z-30 -translate-x-1/2 sm:bottom-8">
          <button
            type="button"
            onClick={cancelPlacement}
            disabled={busy}
            className="hud-chip px-4 py-2 text-xs font-semibold text-[var(--signal-bright)] disabled:opacity-40"
          >
            ✕ Cancel placement
          </button>
        </div>
      )}

      {/* Settle placement dock — house then villager, one blinking tile at a time */}
      {isSettlePlacing && settleSector && !savingLabel && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-3">
          <div className="pointer-events-auto mx-auto w-full max-w-sm">
            <div className="hud-panel p-2.5">
              <p className="text-center font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                {!pendingHouse
                  ? "Step 1 — place your base"
                  : "Step 2 — place your villager"}
              </p>
              <p className="mt-0.5 text-center text-[11px] text-[var(--ink-muted)]">
                {!pendingHouse
                  ? placing?.kind === "house"
                    ? "Now tap the map to plant your base"
                    : "Tap the blinking Base tile, then tap the map"
                  : placing?.kind === "villager"
                    ? "Now tap the map to station your villager"
                    : "Tap the blinking Villager tile, then tap the map"}
              </p>
              <div className="mt-2 flex items-stretch justify-center gap-2">
                <button
                  type="button"
                  data-guide="guide-settle-house"
                  disabled={busy}
                  onClick={() => {
                    if (!settleSector) return;
                    if (pendingHouse) {
                      setPendingHouse(null);
                      setPlacing({ kind: "house", sector: settleSector });
                      showToast("Tap a clear spot to move your base");
                      return;
                    }
                    setPlacing({ kind: "house", sector: settleSector });
                    showToast("Tap the map to plant your base");
                  }}
                  className={`cameo cameo-dock min-w-[5.5rem] flex-1 ${
                    !pendingHouse || placing?.kind === "house"
                      ? "cameo-blink is-guide-hot"
                      : ""
                  }`}
                  title={
                    pendingHouse
                      ? "Tap to move your base"
                      : "Select base, then tap the map"
                  }
                >
                  <HouseSprite className="h-9 w-10 sm:h-10 sm:w-11" />
                  <span className="cameo-label">
                    {pendingHouse ? "Move" : "Base"}
                  </span>
                </button>
                <button
                  type="button"
                  data-guide="guide-settle-villager"
                  disabled={busy || !pendingHouse}
                  onClick={() => {
                    if (!settleSector) return;
                    if (!pendingHouse) {
                      showToast("Place your base first");
                      return;
                    }
                    setPlacing({ kind: "villager", sector: settleSector });
                    showToast("Tap the map to station your villager");
                  }}
                  className={`cameo cameo-dock min-w-[5.5rem] flex-1 ${
                    pendingHouse ? "cameo-blink is-guide-hot" : "opacity-40"
                  }`}
                  title={
                    pendingHouse
                      ? "Select villager, then tap the map"
                      : "Place your base first"
                  }
                >
                  <VillagerSprite walking className="h-9 w-9 sm:h-10 sm:w-10" />
                  <span className="cameo-label">Villager</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPlacing(null);
                  setPendingHouse(null);
                }}
                disabled={busy}
                className="mt-2 w-full text-center font-mono text-[10px] text-[var(--signal-bright)] hover:underline disabled:opacity-40"
              >
                {pendingHouse ? "Clear base & retry" : "Cancel placement"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlacing(null);
                  setPendingHouse(null);
                  setSettleSector(null);
                }}
                disabled={busy}
                className="mt-1 w-full text-center font-mono text-[10px] text-[var(--ink-faint)] hover:underline disabled:opacity-40"
              >
                Exit settle
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Settle prompt (no home yet) — GPS or pick sector ---- */}
      {!claimed && !placing && !settleSector && me && (
        <div className="absolute bottom-28 left-1/2 z-20 w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 sm:bottom-8">
          <div className="hud-panel p-4 text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
              New settler
            </p>
            <p className="mt-1 font-display text-2xl text-[var(--ink)]">
              {gpsFix
                ? azadMode
                  ? AZAD_ARENA_NAME
                  : selected?.name ?? "Your sector"
                : manualMode
                  ? "Pick your sector"
                  : "Where will you settle?"}
            </p>
            <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
              {gpsFix
                ? azadMode
                  ? "Pin set outside the mapped sectors. Settle here, or pick a sector instead."
                  : settlersHere.length > 0
                    ? `${settlersHere.length} settler${settlersHere.length === 1 ? "" : "s"} here — sectors are shared.`
                    : "Location ready. Settle, then plant your base on the map."
                : manualMode
                  ? pickingPin
                    ? "Tap the map to place your pin, or choose a sector below."
                    : "Drag the pin, tap the map, or pick a sector from the list."
                  : locStatus === "failed"
                    ? "GPS didn’t work — try again, or pick a sector on the map."
                    : "Use GPS for your exact spot, or choose a sector yourself."}
            </p>
            {!azadMode && gpsFix && settlersHere.length > 0 && (
              <p className="mt-1 text-[10px] text-[var(--sand)]">
                {settlersHere.map((p) => p.name).join(" · ")}
              </p>
            )}

            {/* Step 1: choose method */}
            {!gpsFix && !manualMode && (
              <>
                <button
                  type="button"
                  disabled={busy || gpsBusy}
                  onClick={useGpsLocation}
                  className="mt-3 w-full rounded-sm bg-[var(--signal)] px-3 py-2.5 text-sm font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.5)] disabled:opacity-40"
                >
                  {gpsBusy
                    ? "Finding you…"
                    : locStatus === "failed"
                      ? "Try GPS again"
                      : "Find my exact location"}
                </button>
                <button
                  type="button"
                  disabled={busy || gpsBusy}
                  onClick={startManualPick}
                  className="mt-2 w-full rounded-sm border border-[var(--line-strong)] bg-[var(--wash)] px-3 py-2.5 text-sm font-semibold text-[var(--ink)] hover:border-[var(--sand)] hover:text-[var(--sand)] disabled:opacity-40"
                >
                  Choose a sector on the map
                </button>
              </>
            )}

            {/* Step 1b: manual — sector list + pin */}
            {!gpsFix && manualMode && (
              <>
                <div className="mt-3 flex max-h-28 flex-wrap justify-center gap-1.5 overflow-y-auto">
                  {(snap?.sectors ?? []).map((s) => {
                    const n = settlersBySector.get(s.id)?.length ?? 0;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={busy}
                        onClick={() => pickSectorFromList(s.id)}
                        className="rounded-sm border border-[var(--line)] px-2 py-1 font-mono text-[10px] text-[var(--ink-muted)] hover:border-[var(--sand)] hover:text-[var(--sand)] disabled:opacity-40"
                      >
                        {s.name}
                        {n > 0 ? ` · ${n}` : ""}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 font-mono text-[9px] text-[#9fd0ff]">
                  {pickingPin
                    ? "Waiting for a map tap…"
                    : "Or drag the blue pin on the map"}
                </p>
                <button
                  type="button"
                  disabled={busy || gpsBusy}
                  onClick={() => {
                    setManualMode(false);
                    setPickingPin(false);
                    setLiveLocation(null);
                    setGpsFix(null);
                  }}
                  className="mt-2 text-[10px] font-mono text-[var(--ink-faint)] underline decoration-dotted underline-offset-2 hover:text-[var(--sand)] disabled:opacity-40"
                >
                  Back — use GPS instead
                </button>
              </>
            )}

            {/* Step 2: location locked → settle */}
            {gpsFix && (
              <>
                {manualMode && (
                  <div className="mt-3 flex max-h-24 flex-wrap justify-center gap-1.5 overflow-y-auto">
                    {(snap?.sectors ?? []).map((s) => {
                      const n = settlersBySector.get(s.id)?.length ?? 0;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={busy}
                          onClick={() => pickSectorFromList(s.id)}
                          className={`rounded-sm border px-2 py-1 font-mono text-[10px] disabled:opacity-40 ${
                            s.id === selectedId
                              ? "border-[var(--sand)] text-[var(--sand)]"
                              : "border-[var(--line)] text-[var(--ink-muted)] hover:border-[var(--sand)] hover:text-[var(--sand)]"
                          }`}
                        >
                          {s.name}
                          {n > 0 ? ` · ${n}` : ""}
                        </button>
                      );
                    })}
                  </div>
                )}
                <button
                  type="button"
                  data-guide="guide-settle"
                  disabled={busy || !me}
                  onClick={() => {
                    setPendingHouse(null);
                    setPickingPin(false);
                    const sector = azadMode
                      ? makeAzadPlacementSector({
                          lat: gpsFix.lat,
                          lng: gpsFix.lng,
                        })
                      : snap?.sectors.find((s) => s.id === gpsFix.sectorId) ??
                        selected;
                    if (!sector) {
                      setError("Pick a sector first");
                      window.setTimeout(() => setError(null), 2800);
                      return;
                    }
                    setManualMode(false);
                    setPlacing(null);
                    setSettleSector(sector);
                    showToast("Tap House below, then plant it on the map");
                  }}
                  className="mt-3 w-full rounded-sm bg-[var(--signal)] px-3 py-2.5 text-sm font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.5)] disabled:opacity-40"
                >
                  Settle
                  {azadMode
                    ? ` in ${AZAD_ARENA_NAME}`
                    : selected
                      ? ` in ${selected.name}`
                      : ""}
                </button>
                <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
                  {!manualMode && (
                    <button
                      type="button"
                      disabled={busy || gpsBusy}
                      onClick={useGpsLocation}
                      className="text-[10px] font-mono text-[var(--ink-faint)] underline decoration-dotted underline-offset-2 hover:text-[var(--sand)] disabled:opacity-40"
                    >
                      {gpsBusy ? "Finding you…" : "Refresh GPS"}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={startManualPick}
                    className="text-[10px] font-mono text-[var(--ink-faint)] underline decoration-dotted underline-offset-2 hover:text-[var(--sand)] disabled:opacity-40"
                  >
                    {manualMode ? "Adjust pin / sector" : "Choose a different sector"}
                  </button>
                  {!azadMode && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        liveLocation
                          ? lockLocation(liveLocation.lat, liveLocation.lng, {
                              forceAzad: true,
                            })
                          : startManualPick()
                      }
                      className="text-[10px] font-mono text-[var(--ink-faint)] underline decoration-dotted underline-offset-2 hover:text-[var(--sand)] disabled:opacity-40"
                    >
                      Play {AZAD_ARENA_NAME}
                    </button>
                  )}
                </div>
              </>
            )}

          </div>
        </div>
      )}

      {/* ---- Clear ground: rocket a same-sector neighbor building ---- */}
      {canRazeSelected && razeOwner && razeBuilding && !placing && !march && (
        <div className="absolute bottom-28 left-1/2 z-20 w-[calc(100%-1.5rem)] max-w-xs -translate-x-1/2 sm:bottom-8">
          <div className="hud-panel p-3 text-center">
            <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-[var(--sand)]">
              Clear ground
            </p>
            <p className="mt-1 font-display text-lg text-[var(--ink)]">
              {catalogItem(razeBuilding.type).name}
            </p>
            <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
              Fire rockets at{" "}
              <strong className="text-[var(--ink)]">{razeOwner.name}</strong>
              &apos;s building to free the ground. Spent rockets are gone —
              they&apos;ll be notified.
            </p>

            <div className="salvo-picker mt-3">
              <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                Rockets to fire
              </p>
              <div className="mt-1.5 flex items-center justify-center gap-3">
                <button
                  type="button"
                  className="salvo-btn"
                  disabled={!me || salvo <= 1}
                  onClick={() => setSalvo((n) => Math.max(1, n - 1))}
                >
                  −
                </button>
                <div className="min-w-[4.5rem]">
                  <p className="font-display text-2xl leading-none text-[var(--sand)]">
                    {salvo}
                  </p>
                  <p className="font-mono text-[8px] text-[var(--ink-faint)]">
                    of {me?.rockets || 0}
                  </p>
                </div>
                <button
                  type="button"
                  className="salvo-btn"
                  disabled={!me || salvo >= (me.rockets || 0)}
                  onClick={() =>
                    setSalvo((n) => Math.min(me?.rockets || 1, n + 1))
                  }
                >
                  +
                </button>
              </div>
              <input
                type="range"
                min={1}
                max={Math.max(1, me?.rockets || 1)}
                value={Math.min(salvo, Math.max(1, me?.rockets || 1))}
                disabled={!me || (me.rockets || 0) <= 0}
                onChange={(e) => setSalvo(Number(e.target.value))}
                className="salvo-range mt-2"
              />
            </div>

            <div className="mt-2 flex items-center justify-center gap-3 font-mono text-[11px]">
              <span className="text-[var(--sand)]">ATK {razeSalvoAttack}</span>
              <span className="text-[var(--ink-faint)]">vs</span>
              <span className="text-[var(--ink-muted)]">
                HP {razeBuildingHp}
              </span>
              <span
                className={`rounded-sm px-1.5 py-0.5 text-[9px] font-bold ${
                  razeSalvoAttack >= razeBuildingHp
                    ? "bg-[rgba(90,154,99,0.35)] text-[var(--field-bright)]"
                    : "bg-[rgba(226,59,47,0.25)] text-[var(--signal-bright)]"
                }`}
              >
                {razeSalvoAttack >= razeBuildingHp ? "Destroy" : "Chip"}
              </span>
            </div>

            <button
              type="button"
              disabled={busy || !me || (me.rockets || 0) <= 0 || !me.house}
              onClick={() => void confirmRaze()}
              className="mt-3 w-full rounded-sm bg-[var(--signal)] px-3 py-2.5 text-sm font-bold text-white disabled:opacity-40"
            >
              {(me?.rockets || 0) <= 0
                ? hasRocketSilo(me)
                  ? "Need rockets"
                  : "Need rocket silo"
                : `Fire ${salvo} rocket${salvo === 1 ? "" : "s"}`}
            </button>
            {hasBarracks(me) && (
              <button
                type="button"
                disabled={busy || !me || (me.troops || 0) <= 0 || !me.house}
                onClick={() => void confirmTroop()}
                className="mt-1.5 w-full rounded-sm border border-[var(--line-strong)] bg-[var(--wash)] px-3 py-2 text-xs font-semibold text-[var(--sand)] disabled:opacity-40"
              >
                {(me?.troops || 0) <= 0
                  ? "Recruit a troop"
                  : `Send troop · ${TROOP_DAMAGE} dmg (stock ${me?.troops || 0})`}
              </button>
            )}
            <button
              type="button"
              className="mt-1.5 font-mono text-[10px] text-[var(--ink-faint)] hover:text-[var(--sand)]"
              onClick={() => setRazeTarget(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Same-sector clear — corner toast, auto-dismisses */}
      {razeAlert && !battleSummary && (
        <div
          className="battle-toast pointer-events-none absolute right-2 z-[60] w-[min(18.5rem,calc(100%-1rem))] sm:right-3"
          style={{
            top: "max(4.25rem, calc(env(safe-area-inset-top) + 3.5rem))",
          }}
          role="status"
          aria-live="polite"
          aria-label="Building destroyed"
        >
          <div className="battle-report battle-report-defense pointer-events-auto p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/65">
                  Same sector
                  {razeAlert.sectorName ? ` · ${razeAlert.sectorName}` : ""}
                </p>
                <p className="font-display text-xl leading-tight text-white sm:text-2xl">
                  {razeAlert.destroyed === false ? "Attacked" : "Destroyed"}
                </p>
                <p className="mt-1.5 text-[13px] leading-snug text-white/90">
                  <strong>{personName(razeAlert.attackerName)}</strong>
                  <span className="font-mono text-[10px] text-[var(--field-bright)]">
                    {" "}
                    (ally)
                  </span>
                  {razeAlert.destroyed === false
                    ? " attacked "
                    : " destroyed "}
                  <strong>Your {razeAlert.buildingName}</strong>
                  {razeAlert.destroyed === false && razeAlert.damage
                    ? ` (${razeAlert.damage} dmg)`
                    : ""}
                  {razeAlert.rocketsLost
                    ? ` with ${razeAlert.rocketsLost} rocket${
                        razeAlert.rocketsLost === 1 ? "" : "s"
                      }`
                    : ""}
                  .
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-sm border border-white/30 px-2 py-0.5 text-[10px] font-bold text-white/90"
                onClick={dismissRazeAlert}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gem snatch — corner toast */}
      {gemClaimAlert && !battleSummary && !razeAlert && (
        <div
          className="battle-toast pointer-events-none absolute right-2 z-[60] w-[min(18.5rem,calc(100%-1rem))] sm:right-3"
          style={{
            top: "max(4.25rem, calc(env(safe-area-inset-top) + 3.5rem))",
          }}
          role="status"
          aria-live="polite"
          aria-label="Gem claimed"
        >
          <div className="battle-report battle-report-defense pointer-events-auto p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/65">
                  Find stolen
                </p>
                <p className="font-display text-xl leading-tight text-white sm:text-2xl">
                  Gem claimed
                </p>
                <p className="mt-1.5 text-[13px] leading-snug text-white/90">
                  {(() => {
                    const claimer = snap?.players.find(
                      (p) => p.id === gemClaimAlert.attackerId
                    );
                    const ally =
                      Boolean(me?.homeSectorId) &&
                      claimer?.homeSectorId === me?.homeSectorId;
                    const gemLabel =
                      GEM_META[gemClaimAlert.gem]?.label ?? "gem";
                    return (
                      <>
                        {ally ? "Your ally" : "Enemy"}{" "}
                        <strong>
                          {personName(gemClaimAlert.attackerName)}
                        </strong>{" "}
                        from{" "}
                        <strong>{gemClaimAlert.claimerSectorName}</strong>{" "}
                        claimed your <strong>{gemLabel}</strong>
                        {gemClaimAlert.gold
                          ? ` (+${GOLD_COIN}${gemClaimAlert.gold})`
                          : ""}
                        .
                      </>
                    );
                  })()}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-sm border border-white/30 px-2 py-0.5 text-[10px] font-bold text-white/90"
                onClick={dismissGemClaimAlert}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activity summary — global + personal */}
      {showActivity && (
        <div
          className="absolute inset-0 z-40 flex items-end justify-center bg-black/50 p-3 sm:items-center"
          onClick={() => setShowActivity(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowActivity(false);
          }}
          role="presentation"
        >
          <div
            className="hud-panel max-h-[min(80dvh,36rem)] w-full max-w-md overflow-hidden p-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Activity summary"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl text-[var(--ink)]">
                  Activity
                </h2>
                <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                  Attacks & sabotage
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowActivity(false)}
                className="font-mono text-[14px] text-[var(--ink-faint)] hover:text-[var(--sand)]"
              >
                ✕
              </button>
            </div>

            <div className="mt-3 flex gap-1 rounded-sm bg-[var(--wash)] p-0.5">
              <button
                type="button"
                className={`flex-1 rounded-sm px-2 py-1.5 font-mono text-[10px] ${
                  activityTab === "global"
                    ? "bg-[var(--signal)] font-bold text-white"
                    : "text-[var(--ink-muted)]"
                }`}
                onClick={() => setActivityTab("global")}
              >
                Sector wars
              </button>
              <button
                type="button"
                className={`flex-1 rounded-sm px-2 py-1.5 font-mono text-[10px] ${
                  activityTab === "you"
                    ? "bg-[var(--signal)] font-bold text-white"
                    : "text-[var(--ink-muted)]"
                }`}
                onClick={() => setActivityTab("you")}
              >
                Your wars
              </button>
            </div>

            <ul className="mt-3 max-h-[min(55dvh,24rem)] space-y-1.5 overflow-y-auto pr-1">
              {(activityTab === "global"
                ? [...(snap?.globalEvents ?? [])].reverse()
                : [...(snap?.events ?? [])].reverse()
              ).length === 0 ? (
                <li className="text-[12px] text-[var(--ink-faint)]">
                  {activityTab === "global"
                    ? "No sector wars yet — attacks and sabotage show up here."
                    : "No wars involving you yet."}
                </li>
              ) : (
                (activityTab === "global"
                  ? [...(snap?.globalEvents ?? [])].reverse()
                  : [...(snap?.events ?? [])].reverse()
                ).map((e) => (
                  <li
                    key={e.id}
                    className="rounded-sm border border-[var(--line)] px-2.5 py-2 text-[11px] text-[var(--ink-muted)]"
                  >
                    <p className="font-semibold text-[var(--ink)]">
                      {activityLine(e, me?.id, playerColors)}
                    </p>
                    <p className="mt-0.5 font-mono text-[9px] text-[var(--ink-faint)]">
                      {isGemClaimEvent(e)
                        ? "Find claim"
                        : isRazeEvent(e)
                          ? "Sabotage"
                          : isCdaRaidEvent(e)
                            ? "CDA raid"
                            : "Attack"}{" "}
                      · {timeAgo(e.ts, relativeNow)}
                    </p>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}

      {/* ---- Attack panel: after tapping any enemy building/house ---- */}
      {enemySelected &&
        enemyPlayer &&
        !placing &&
        !needsHouseRebuild &&
        !march && (
        <div className="absolute bottom-28 left-1/2 z-20 w-[calc(100%-1.5rem)] max-w-xs -translate-x-1/2 sm:bottom-8">
          <div className="hud-panel p-3 text-center">
            <p className="font-display text-lg text-[var(--ink)]">
              {enemyPlayer.name}
            </p>
            <p className="text-[10px] text-[var(--ink-muted)]">
              Village in{" "}
              {snap?.sectors.find((s) => s.id === enemyPlayer.homeSectorId)
                ?.name ?? "sector"}
            </p>

            {/* Salvo picker */}
            <div className="salvo-picker mt-3">
              <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                Rockets to fire
              </p>
              <div className="mt-1.5 flex items-center justify-center gap-3">
                <button
                  type="button"
                  className="salvo-btn"
                  disabled={!me || salvo <= 1}
                  onClick={() => setSalvo((n) => Math.max(1, n - 1))}
                >
                  −
                </button>
                <div className="min-w-[4.5rem]">
                  <p className="font-display text-2xl leading-none text-[var(--sand)]">
                    {salvo}
                  </p>
                  <p className="font-mono text-[8px] text-[var(--ink-faint)]">
                    of {me?.rockets || 0}
                  </p>
                </div>
                <button
                  type="button"
                  className="salvo-btn"
                  disabled={!me || salvo >= (me.rockets || 0)}
                  onClick={() =>
                    setSalvo((n) => Math.min(me?.rockets || 1, n + 1))
                  }
                >
                  +
                </button>
              </div>
              <input
                type="range"
                min={1}
                max={Math.max(1, me?.rockets || 1)}
                value={Math.min(salvo, Math.max(1, me?.rockets || 1))}
                disabled={!me || (me.rockets || 0) <= 0}
                onChange={(e) => setSalvo(Number(e.target.value))}
                className="salvo-range mt-2"
              />
            </div>

            <div className="mt-2 flex items-center justify-center gap-3 font-mono text-[11px]">
              <span className="text-[var(--sand)]">
                ATK {salvoAttack}
              </span>
              <span className="text-[var(--ink-faint)]">vs</span>
              <span className="text-[var(--ink-muted)]">
                DEF {enemyDefense}
              </span>
              <span
                className={`rounded-sm px-1.5 py-0.5 text-[9px] font-bold ${
                  salvoAttack > enemyDefense
                    ? "bg-[rgba(90,154,99,0.35)] text-[var(--field-bright)]"
                    : "bg-[rgba(226,59,47,0.25)] text-[var(--signal-bright)]"
                }`}
              >
                {salvoAttack > enemyDefense ? "Breach" : "Hold"}
              </span>
            </div>
            <p className="mt-1 text-[9px] text-[var(--ink-faint)]">
              Fired rockets are spent · {defenseBreakdown(enemyPlayer)}
            </p>
            <button
              type="button"
              disabled={
                busy ||
                !me ||
                !me.house ||
                !hasRocketSilo(me) ||
                (me.rockets || 0) <= 0 ||
                Boolean(march)
              }
              onClick={() => void launchAttack()}
              className="mt-2 w-full rounded-sm bg-[var(--signal)] px-3 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              ✦ Fire {salvo} rocket{salvo === 1 ? "" : "s"}
            </button>
            {hasBarracks(me) && enemyPlayer.buildings.length > 0 && (
              <button
                type="button"
                disabled={
                  busy || !me || !me.house || (me.troops || 0) <= 0 || Boolean(march)
                }
                onClick={() => {
                  const target = [...enemyPlayer.buildings].sort(
                    (a, b) => b.builtAt - a.builtAt
                  )[0];
                  if (!target) return;
                  void act("send_troop", {
                    targetPlayerId: enemyPlayer.id,
                    buildingId: target.id,
                  }).then((d) => {
                    if (!d) return;
                    const sabotage = d.sabotage as
                      | {
                          destroyed?: boolean;
                          damage?: number;
                          buildingName?: string;
                          buildingHp?: number;
                        }
                      | undefined;
                    playAttackSound();
                    showToast(
                      sabotage?.destroyed
                        ? `Troop destroyed ${enemyPlayer.name}'s ${
                            sabotage.buildingName || "building"
                          }`
                        : `Troop hit ${enemyPlayer.name}'s ${
                            sabotage?.buildingName || "building"
                          } — ${sabotage?.damage ?? TROOP_DAMAGE} dmg`
                    );
                  });
                }}
                className="mt-1.5 w-full rounded-sm border border-[var(--line-strong)] bg-[var(--wash)] px-3 py-2 text-xs font-semibold text-[var(--sand)] disabled:opacity-40"
              >
                {(me?.troops || 0) <= 0
                  ? "Recruit a troop"
                  : `Send troop at building · ${TROOP_DAMAGE} dmg`}
              </button>
            )}
            <button
              type="button"
              className="mt-1.5 text-[9px] font-mono text-[var(--ink-faint)] underline decoration-dotted"
              onClick={() => setSelectedPlayerId(null)}
            >
              Cancel target
            </button>
            {me && !hasRocketSilo(me) && (
              <p className="mt-1 text-[9px] text-[var(--ink-faint)]">
                Build a Rocket Silo to unlock rocket raids
              </p>
            )}
            {me && hasRocketSilo(me) && (me.rockets || 0) <= 0 && (
              <p className="mt-1 text-[9px] text-[var(--ink-faint)]">
                Stock rockets in Arsenal first
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---- Chat while unsettled (no dock yet) ---- */}
      {visitorId && !claimed && (
        <div className="pointer-events-none absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-2 z-30 sm:right-3">
          <PublicChat
            visitorId={visitorId}
            displayName={displayName || me?.name || "Scout"}
            onSent={noteLocalMessage}
            onRename={renamePresence}
            placement="bottom"
          />
        </div>
      )}

      {/* ---- Bottom dock: status + chat above arsenal/build ---- */}
      {claimed && me && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-3 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex w-full flex-col gap-1">
            <div className="flex w-full items-end justify-between gap-2">
              <div className="hud-status pointer-events-auto min-w-0">
                <div
                  className="hud-status-chip"
                  title={`${me.villagers} villager(s) gathering`}
                >
                  <VillagerSprite walking className="h-5 w-5" />
                  <span>{me.villagers}</span>
                </div>
                <div
                  className={`hud-status-chip ${
                    me.house ? "hud-status-chip--hp" : "hud-status-chip--down"
                  }`}
                  title={
                    me.house
                      ? `Base health ${me.houseHp}/${houseMaxHp(me)}${
                          me.fortified ? " · walls" : ""
                        }`
                      : "Base destroyed — rebuild to gather"
                  }
                >
                  <HouseSprite className="h-5 w-6" />
                  {me.house ? (
                    <span
                      className="hud-status-hp"
                      aria-label={`Base health ${me.houseHp} of ${houseMaxHp(me)}`}
                    >
                      <span
                        className="hud-status-hp-fill"
                        style={{
                          width: `${Math.max(
                            0,
                            Math.min(
                              100,
                              ((me.houseHp ?? houseMaxHp(me)) /
                                houseMaxHp(me)) *
                                100
                            )
                          )}%`,
                          background:
                            (me.houseHp ?? houseMaxHp(me)) / houseMaxHp(me) >
                            0.55
                              ? "#5a9a63"
                              : (me.houseHp ?? houseMaxHp(me)) /
                                    houseMaxHp(me) >
                                  0.25
                                ? "#e8cf8a"
                                : "#ff5245",
                        }}
                      />
                    </span>
                  ) : (
                    <span>✕</span>
                  )}
                </div>
                <div
                  className="hud-status-chip"
                  title={`Arsenal: ${me.rockets || 0} rocket(s) · ${myAttack} attack power`}
                >
                  <RocketSprite className="h-5 w-5" />
                  <span>{me.rockets || 0}</span>
                </div>
                {gemsFound > 0 && (
                  <div
                    className="hud-status-chip"
                    title={`${gemsFound} resource site(s) found`}
                  >
                    <ResourceGem gem="diamond" size={16} pulse />
                    <span>{gemsFound}</span>
                  </div>
                )}
              </div>

              {visitorId && (
                <PublicChat
                  visitorId={visitorId}
                  displayName={displayName || me?.name || "Scout"}
                  onSent={noteLocalMessage}
                  onRename={renamePresence}
                  placement="bottom"
                />
              )}
            </div>

            <div className="pointer-events-auto w-full min-w-0 sm:max-w-[min(100%,42rem)]">
              <div className="hud-panel hud-panel-arsenal p-1.5 sm:p-2">
                {needsHouseRebuild ? (
                  <>
                    <p className="mb-1.5 text-center font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--signal-bright)]">
                      Base destroyed — rebuild to gather &amp; build again
                    </p>
                    <div className="flex justify-center">
                      <button
                        type="button"
                        className={`cameo cameo-dock min-w-[6.5rem] ${
                          placing?.kind === "house"
                            ? "cameo-active cameo-blink"
                            : "cameo-blink"
                        }`}
                        disabled={busy}
                        title="Rebuild your base — rockets and buildings stay locked until then"
                        onClick={() => {
                          if (!me.homeSectorId) return;
                          if (isAzadHomeId(me.homeSectorId)) {
                            setPendingHouse(null);
                            setPlacing({
                              kind: "house",
                              sector: makeAzadPlacementSector(
                                liveLocation ?? me.villagerPost
                              ),
                            });
                            showToast("Tap near your pin to rebuild your base");
                            return;
                          }
                          const sector = snap?.sectors.find(
                            (s) => s.id === me.homeSectorId
                          );
                          if (!sector) return;
                          setSelectedId(sector.id);
                          setPendingHouse(null);
                          setPlacing({ kind: "house", sector });
                          showToast("Tap the map to rebuild your base");
                        }}
                      >
                        <HouseSprite className="h-9 w-10 sm:h-10 sm:w-11" />
                        <span className="cameo-label">
                          {placing?.kind === "house" ? "Placing…" : "Base"}
                        </span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="arsenal-dock-row flex w-full items-stretch gap-1 sm:gap-1.5">
                    <button
                      type="button"
                      className={`cameo cameo-dock ${
                        buyingRocket ? "cameo-building" : ""
                      } ${
                        !buyingRocket &&
                        hasRocketSilo(me) &&
                        displayGold >= ROCKET_COST &&
                        me.house
                          ? "cameo-blink"
                          : ""
                      }`}
                      disabled={
                        busy ||
                        buyingRocket ||
                        !hasRocketSilo(me) ||
                        displayGold < ROCKET_COST ||
                        !me.house
                      }
                      title={
                        !hasRocketSilo(me)
                          ? "Build a Rocket Silo to unlock rockets"
                          : buyingRocket
                            ? "Building rocket…"
                            : `Buy rocket — ${GOLD_COIN}${ROCKET_COST} · +1 attack (expended when you fire)`
                      }
                      onClick={() => {
                        if (buyingRocket || busyRef.current) return;
                        if (!hasRocketSilo(me)) {
                          showToast("Build a Rocket Silo first");
                          return;
                        }
                        setBuyingRocket(true);
                        void act("buy_rocket", {}, undefined, { silent: true })
                          .then((d) => {
                            if (d) {
                              playRecruitSound();
                              showToast("Rocket stocked · +1 attack");
                            }
                          })
                          .finally(() => setBuyingRocket(false));
                      }}
                    >
                      <RocketSprite className="h-8 w-8 sm:h-9 sm:w-9" />
                      <span className="cameo-cost">
                        {hasRocketSilo(me) ? (
                          <>
                            <GoldCoinIcon size={10} />
                            {ROCKET_COST}
                          </>
                        ) : (
                          "Silo"
                        )}
                      </span>
                      <span className="cameo-label">
                        {buyingRocket
                          ? "Building…"
                          : hasRocketSilo(me)
                            ? "Rocket"
                            : "Locked"}
                      </span>
                      {buyingRocket && <CameoBuildLoader />}
                    </button>

                    <button
                      type="button"
                      className={`cameo cameo-dock ${
                        buyingTroop ? "cameo-building" : ""
                      } ${
                        !buyingTroop &&
                        hasBarracks(me) &&
                        displayGold >= TROOP_COST &&
                        me.house
                          ? "cameo-blink"
                          : ""
                      }`}
                      disabled={
                        busy ||
                        buyingTroop ||
                        !hasBarracks(me) ||
                        displayGold < TROOP_COST ||
                        !me.house
                      }
                      title={
                        !hasBarracks(me)
                          ? "Build Barracks to recruit troops"
                          : buyingTroop
                            ? "Recruiting…"
                            : `Recruit troop — ${GOLD_COIN}${TROOP_COST} · deals ${TROOP_DAMAGE} dmg to enemy buildings (stock ${me.troops || 0})`
                      }
                      onClick={() => {
                        if (buyingTroop || busyRef.current) return;
                        if (!hasBarracks(me)) {
                          showToast("Build Barracks first");
                          return;
                        }
                        setBuyingTroop(true);
                        void act("buy_troop", {}, undefined, { silent: true })
                          .then((d) => {
                            if (d) {
                              playRecruitSound();
                              showToast(
                                `Troop ready · stock ${(me.troops || 0) + 1}`
                              );
                            }
                          })
                          .finally(() => setBuyingTroop(false));
                      }}
                    >
                      <TroopSprite className="h-8 w-8 sm:h-9 sm:w-9" />
                      <span className="cameo-cost">
                        {hasBarracks(me) ? (
                          <>
                            <GoldCoinIcon size={10} />
                            {TROOP_COST}
                          </>
                        ) : (
                          "Barracks"
                        )}
                      </span>
                      <span className="cameo-label">
                        {buyingTroop
                          ? "Hiring…"
                          : hasBarracks(me)
                            ? `Troop${(me.troops || 0) > 0 ? ` · ${me.troops}` : ""}`
                            : "Locked"}
                      </span>
                      {buyingTroop && <CameoBuildLoader />}
                    </button>

                    <button
                      type="button"
                      className={`cameo cameo-dock ${
                        buyingWalls ? "cameo-building" : ""
                      } ${
                        !buyingWalls &&
                        !me.fortified &&
                        displayGold >= BASE_WALL_COST &&
                        me.house
                          ? "cameo-blink"
                          : ""
                      }`}
                      disabled={
                        busy ||
                        buyingWalls ||
                        Boolean(me.fortified) ||
                        displayGold < BASE_WALL_COST ||
                        !me.house
                      }
                      title={
                        me.fortified
                          ? "Fortress walls already raised"
                          : buyingWalls
                            ? "Raising walls…"
                            : `Stone walls around your base — ${GOLD_COIN}${BASE_WALL_COST} · +${BASE_FORTIFIED_DEFENSE - 1} defense · ${FORTIFIED_HOUSE_MAX_HP} HP`
                      }
                      onClick={() => {
                        if (buyingWalls || busyRef.current || me.fortified)
                          return;
                        setBuyingWalls(true);
                        void act("fortify_base", {}, undefined, {
                          silent: true,
                        })
                          .then((d) => {
                            if (d) {
                              playBuildSound();
                              showToast(
                                `Fortress walls raised · DEF ${BASE_FORTIFIED_DEFENSE} · ${FORTIFIED_HOUSE_MAX_HP} HP`
                              );
                            }
                          })
                          .finally(() => setBuyingWalls(false));
                      }}
                    >
                      <WallsSprite className="h-8 w-8 sm:h-9 sm:w-9" />
                      <span className="cameo-cost">
                        {me.fortified ? (
                          "Done"
                        ) : (
                          <>
                            <GoldCoinIcon size={10} />
                            {BASE_WALL_COST}
                          </>
                        )}
                      </span>
                      <span className="cameo-label">
                        {buyingWalls
                          ? "Raising…"
                          : me.fortified
                            ? "Walled"
                            : "Walls"}
                      </span>
                      {buyingWalls && <CameoBuildLoader />}
                    </button>

                    <button
                      type="button"
                      className={`cameo cameo-dock ${
                        plantingSat || npcPlacing === "spy_sat"
                          ? "cameo-building"
                          : ""
                      } ${
                        !plantingSat &&
                        npcPlacing !== "spy_sat" &&
                        hasBarracks(me) &&
                        displayGold >= SPY_SAT_COST &&
                        me.house
                          ? "cameo-blink"
                          : ""
                      }`}
                      disabled={
                        busy ||
                        plantingSat ||
                        !hasBarracks(me) ||
                        displayGold < SPY_SAT_COST ||
                        !me.house
                      }
                      title={
                        !hasBarracks(me)
                          ? "Build Barracks to send spies"
                          : `Send spy into an enemy sector — ${GOLD_COIN}${SPY_SAT_COST} · drains their gold`
                      }
                      onClick={() => {
                        if (plantingSat || busyRef.current) return;
                        if (!hasBarracks(me)) {
                          showToast("Build Barracks to unlock spies");
                          return;
                        }
                        setPlacing(null);
                        setNpcPlacing("spy_sat");
                        showToast(
                          "Tap inside an enemy sector to plant a spy"
                        );
                      }}
                    >
                      <SpySatSprite className="h-8 w-8 sm:h-9 sm:w-9" />
                      <span className="cameo-cost">
                        {hasBarracks(me) ? (
                          <>
                            <GoldCoinIcon size={10} />
                            {SPY_SAT_COST}
                          </>
                        ) : (
                          "Barracks"
                        )}
                      </span>
                      <span className="cameo-label">
                        {npcPlacing === "spy_sat"
                          ? "Planting…"
                          : hasBarracks(me)
                            ? "Spy"
                            : "Locked"}
                      </span>
                      {plantingSat && <CameoBuildLoader />}
                    </button>

                    <div className="w-px shrink-0 self-stretch bg-[var(--line)]" />

                    {(snap?.buildingCatalog ?? []).map((b) => {
                      const affordable = displayGold >= b.cost;
                      const active = placing?.kind === b.type;
                      const syncing = syncingBuildTypes.has(b.type);
                      const homeSector = isAzadHomeId(me.homeSectorId)
                        ? makeAzadPlacementSector(me.house)
                        : snap?.sectors.find((s) => s.id === me.homeSectorId);
                      const shortLabel =
                        b.type === "warehouse"
                          ? "Store"
                          : b.type === "mill"
                            ? "Mill"
                            : b.type === "well"
                              ? "Well"
                              : b.type === "shovel"
                                ? "Shovel"
                                : b.type === "barracks"
                                  ? "Barracks"
                                  : b.type === "silo"
                                    ? "Silo"
                                    : b.type === "civic"
                                      ? "Civic"
                                      : b.type === "prado"
                                        ? "Prado"
                                        : b.type === "landcruiser"
                                          ? "Cruiser"
                                          : b.name;
                      return (
                        <button
                          key={b.type}
                          type="button"
                          className={`cameo cameo-dock ${
                            active ? "cameo-active" : ""
                          } ${syncing ? "cameo-building" : ""} ${
                            affordable && !active && !syncing
                              ? "cameo-blink"
                              : ""
                          }`}
                          disabled={
                            busy ||
                            syncing ||
                            !affordable ||
                            !homeSector ||
                            !me.house
                          }
                          title={
                            syncing
                              ? `Building ${b.name}…`
                              : `${b.name} — ${b.blurb} · ${b.footprintM}m ground`
                          }
                          onClick={() =>
                            setPlacing((cur) =>
                              cur?.kind === b.type || !homeSector || !me.house
                                ? null
                                : { kind: b.type, sector: homeSector }
                            )
                          }
                        >
                          <BuildingThumb
                            type={b.type}
                            className="h-8 w-9 sm:h-9 sm:w-10"
                          />
                          <span className="cameo-cost">
                            <GoldCoinIcon size={10} />
                            {formatGoldCompact(b.cost)}
                          </span>
                          <span className="cameo-label">
                            {syncing ? "Building…" : shortLabel}
                          </span>
                          {syncing && <CameoBuildLoader />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
