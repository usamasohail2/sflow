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
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { PublicChat } from "@/components/PublicChat";
import {
  Walkthrough,
  clearWalkthroughDone,
  readWalkthroughDone,
} from "@/components/Walkthrough";
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
  HammerSprite,
  HouseSprite,
  MillSprite,
  RocketSprite,
  TurretSprite,
  VillagerSprite,
  WarehouseSprite,
  WellSprite,
} from "@/components/sprites";
import { ResourceGem } from "@/components/ResourceGem";
import type {
  BattleReport,
  Building,
  BuildingType,
  GameEvent,
  GameSnapshot,
  Player,
  RazeEvent,
} from "@/lib/gameTypes";
import {
  GOLD_COIN,
  HOUSE_MAX_HP,
  ROCKET_COST,
  attackPower,
  buildingBonus,
  catalogItem,
  defenseBreakdown,
  defensePower,
  isAttackEvent,
  isRazeEvent,
} from "@/lib/gameTypes";
import { pointInOrNearRing } from "@/lib/geo";
import { ringCentroid } from "@/lib/mapMath";
import {
  isMusicOn,
  installUiSounds,
  playAttackSound,
  playBuildSound,
  playCoinSound,
  playRecruitSound,
  playUnderAttackSound,
  readMusicPref,
  startMusic,
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
  if (type === "turret") return <TurretSprite className={className} />;
  return <WellSprite className={className} />;
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
}: {
  id: string;
  name: string;
  myId?: string | null;
  colors?: Map<string, string> | Record<string, string> | null;
  possessive?: boolean;
}) {
  const isYou = Boolean(myId && id === myId);
  const color = playerColor(id, colors);
  if (isYou && possessive) {
    return (
      <span className="font-bold" style={{ color }}>
        your
      </span>
    );
  }
  const label = isYou ? "You" : personName(name);
  return (
    <span className="font-bold" style={{ color }}>
      {possessive ? `${label}'s` : label}
    </span>
  );
}

type ActivityColors = Map<string, string> | Record<string, string> | null;

function summaryFromAttack(
  battle: BattleReport,
  sectorName: string,
  defenderName: string,
  id = `atk_${Date.now()}`
): BattleSummary {
  return {
    id,
    role: "attacker",
    headline: battle.win ? "Raid succeeded" : "Raid failed",
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

  return {
    id: e.id,
    role: "defender",
    headline: e.win ? "Village breached" : "Defense held",
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

const RAZE_VERBS = ["destroyed", "wrecked", "razed", "tore down"] as const;
const ATTACK_WIN_VERBS = ["attacked", "breached", "wrecked", "smashed"] as const;
const ATTACK_HOLD_VERBS = ["held off", "stopped", "repelled"] as const;

function eventLogLine(
  e: GameEvent,
  myId: string | undefined,
  colors?: ActivityColors
): ReactNode {
  if (isRazeEvent(e)) {
    const verb = pickVariant(e.id, RAZE_VERBS);
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
          {e.buildingName} in {e.sectorName}
        </>
      );
    }
    return (
      <>
        Your ally,{" "}
        <NameChip id={e.attackerId} name={e.attackerName} myId={myId} colors={colors} />,{" "}
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
    const verb = pickVariant(e.id, RAZE_VERBS);
    if (myId && e.defenderId === myId && e.attackerId !== myId) {
      return (
        <>
          Your ally,{" "}
          <NameChip id={e.attackerId} name={e.attackerName} myId={myId} colors={colors} />,{" "}
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
        {e.buildingName} · {e.sectorName}
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
  const [showMenu, setShowMenu] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  const [showBattles, setShowBattles] = useState(false);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [placing, setPlacing] = useState<Placing | null>(null);
  /** Building ids currently syncing to the server (optimistic place) */
  const [syncingBuildIds, setSyncingBuildIds] = useState<string[]>([]);
  /** Mobile: build tray collapsed by default so it doesn't stack over arsenal */
  /** Mobile: open by default so build tiles use the free dock space */
  const [buildOpen, setBuildOpen] = useState(true);
  const [pendingHouse, setPendingHouse] = useState<LatLng | null>(null);
  const [march, setMarch] = useState<MarchAnim | null>(null);
  const [impact, setImpact] = useState<ImpactAnim | null>(null);
  const [battleSummary, setBattleSummary] = useState<BattleSummary | null>(
    null
  );
  /** Live GPS pin shown on the map while picking a sector */
  const [liveLocation, setLiveLocation] = useState<LatLng | null>(null);
  /** GPS fix confirmed inside the sector being settled */
  const [gpsFix, setGpsFix] = useState<{
    sectorId: string;
    lat: number;
    lng: number;
  } | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [locationFocus, setLocationFocus] = useState(0);
  /** Bump to re-fly the map when the same sector is picked again */
  const [sectorFocus, setSectorFocus] = useState(0);
  const [reviewBiz, setReviewBiz] = useState<MapBusiness | null>(null);
  const [reviewOpenedAt, setReviewOpenedAt] = useState<number | null>(null);
  const [reviewReady, setReviewReady] = useState(false);
  const [musicOn, setMusicOn] = useState(false);
  const gpsWatchStarted = useRef(false);
  const identityChecked = useRef(false);
  const seenEvents = useRef<Set<string>>(new Set());
  const eventsPrimed = useRef(false);
  const meIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const settleGuardUntil = useRef(0);
  const lastGoodMe = useRef<Player | null>(null);
  const lastInviteCount = useRef<number | null>(null);
  const walkthroughArmed = useRef(false);

  const IDENT_KEY = "itw_player_id";

  const {
    visitorId,
    displayName,
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

  const applySnap = useCallback((data: GameSnapshot) => {
    let next = data;
    const prevMe = lastGoodMe.current;
    const incoming = data.me;
    // Guard against a stale poll wiping a just-saved settlement (~3s race)
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
        next = {
          ...data,
          me: prevMe,
          players: data.players.map((p) =>
            p.id === prevMe.id
              ? {
                  ...p,
                  homeSectorId: prevMe.homeSectorId,
                  house: prevMe.house,
                  houseHp: prevMe.houseHp,
                  villagerPost: prevMe.villagerPost,
                  villagers: prevMe.villagers,
                  gold: prevMe.gold,
                  buildings: prevMe.buildings,
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

    setSnap(next);
    if (next.me) setDisplayGold(next.me.gold);
    setSelectedId(
      (cur) => cur ?? next.me?.homeSectorId ?? next.sectors[0]?.id ?? null
    );

    const nextId = next.me?.id ?? null;
    if (nextId !== meIdRef.current) {
      // New identity (first load or player switch) — don't replay history
      meIdRef.current = nextId;
      seenEvents.current = new Set();
      eventsPrimed.current = false;
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
        window.setTimeout(() => {
          setRazeAlert(e);
          setShowBattles(false);
          setShowActivity(false);
        }, 400);
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

  const load = useCallback(async () => {
    const invite = captureInviteFromUrl();
    const q = invite ? `?invite=${encodeURIComponent(invite)}` : "";
    const res = await fetch(`/api/game${q}`);
    const data = (await res.json()) as GameSnapshot;

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

    applySnap(data);
  }, [applySnap]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      // Don't poll-overwrite while a settle/build write is in flight
      if (busyRef.current) return;
      void load();
    }, 4000);
    return () => window.clearInterval(id);
  }, [load]);

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

  // Prefer in-game settler name for chat / floating label
  useEffect(() => {
    const name = me?.name?.trim();
    if (!name || name.length < 2) return;
    if (name === displayName) return;
    renamePresence(name);
  }, [me?.name, displayName, renamePresence]);

  const claimed = Boolean(me?.homeSectorId);
  const needsHouseRebuild = Boolean(claimed && me && !me.house);
  const homeName =
    snap?.sectors.find((s) => s.id === me?.homeSectorId)?.name ?? null;
  const myAttack = me ? attackPower(me.rockets || 0) : 0;
  const myDefense = me
    ? defensePower({
        buildings: me.buildings,
        house: me.house,
        houseHp: me.houseHp,
      })
    : 0;
  const salvoAttack = attackPower(salvo);
  const settlersBySector = useMemo(() => {
    const map = new Map<string, NonNullable<typeof snap>["players"]>();
    for (const p of snap?.players ?? []) {
      if (!p.homeSectorId) continue;
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
    if (!me) return 0;
    return me.discoveredSpotIds.filter((id) =>
      snap?.spots.some((s) => s.id === id && s.kind === "hidden")
    ).length;
  }, [me, snap]);

  /** Sector leaderboard — total resources farmed by everyone in each sector */
  const sectorRanking = useMemo(() => {
    const bySector = new Map<
      string,
      { id: string; name: string; farmed: number; settlers: number }
    >();
    for (const s of snap?.sectors ?? []) {
      bySector.set(s.id, { id: s.id, name: s.name, farmed: 0, settlers: 0 });
    }
    for (const p of snap?.players ?? []) {
      if (!p.homeSectorId) continue;
      const row = bySector.get(p.homeSectorId);
      if (!row) {
        bySector.set(p.homeSectorId, {
          id: p.homeSectorId,
          name:
            snap?.sectors.find((s) => s.id === p.homeSectorId)?.name ??
            p.homeSectorId,
          farmed: p.totalFarmed || 0,
          settlers: 1,
        });
        continue;
      }
      row.farmed += p.totalFarmed || 0;
      row.settlers += 1;
    }
    return Array.from(bySector.values()).sort((a, b) => b.farmed - a.farmed);
  }, [snap]);

  const topSectors = sectorRanking.slice(0, 5);

  /** HUD board: top 5, plus your sector with real rank if outside top 5 */
  const sectorBoard = useMemo(() => {
    const rows = topSectors.map((r, i) => ({
      ...r,
      rank: i + 1,
      mine: me?.homeSectorId === r.id,
    }));
    const homeId = me?.homeSectorId;
    if (!homeId) return rows;
    if (rows.some((r) => r.id === homeId)) return rows;
    const idx = sectorRanking.findIndex((r) => r.id === homeId);
    if (idx < 0) return rows;
    const mine = sectorRanking[idx]!;
    return [
      ...rows,
      { ...mine, rank: idx + 1, mine: true },
    ];
  }, [topSectors, sectorRanking, me?.homeSectorId]);

  const missionList = useMemo(() => {
    if (!me) return [];
    return [
      {
        id: "settle",
        label: "Settle in a sector",
        done: Boolean(me.homeSectorId),
      },
      {
        id: "watch",
        label: "Earn gold from automatic gathering",
        done: me.gold > 0,
      },
      {
        id: "explore",
        label: "Roam zoomed-in until a resource spawns",
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

  const showToast = (msg: string) => {
    setToast(msg);
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
        setError(data.error || "Action failed");
        window.setTimeout(() => setError(null), 3200);
        return null;
      }
      if (
        action === "claim_sector" ||
        action === "place_house" ||
        action === "build"
      ) {
        settleGuardUntil.current = Date.now() + 20_000;
      }
      applySnap(data as GameSnapshot);
      return data;
    } catch {
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
      const gem = String(data.gem || "resource");
      showToast(
        data.bonus
          ? `${gem[0].toUpperCase()}${gem.slice(1)} found ahead! +${GOLD_COIN}${data.bonus}`
          : "A resource appeared ahead!"
      );
      return true;
    } catch {
      return false;
    }
  };

  const applyGpsReading = (lat: number, lng: number, sectorId?: string) => {
    setLiveLocation({ lat, lng });
    setLocationFocus((n) => n + 1);
    if (!sectorId || !snap) return;
    const sector = snap.sectors.find((s) => s.id === sectorId);
    if (!sector) return;
    if (!pointInOrNearRing({ lat, lng }, sector.ring, 120)) {
      setGpsFix(null);
      setError(
        `GPS says you're outside ${sector.name} — go there, then try again`
      );
      window.setTimeout(() => setError(null), 4200);
      return;
    }
    setGpsFix({ sectorId, lat, lng });
    showToast(`Location confirmed in ${sector.name}`);
  };

  const requestGps = (sectorId?: string) => {
    if (!navigator.geolocation) {
      setError("GPS is not available on this device");
      window.setTimeout(() => setError(null), 3200);
      return;
    }
    setGpsBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsBusy(false);
        applyGpsReading(pos.coords.latitude, pos.coords.longitude, sectorId);
      },
      () => {
        setGpsBusy(false);
        setError("Couldn't read GPS — allow location access and retry");
        window.setTimeout(() => setError(null), 4200);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5_000 }
    );
  };

  const confirmGpsForSector = (sectorId: string) => {
    requestGps(sectorId);
  };

  /** Demo-only: skip real GPS and treat the sector center as your location */
  const bypassGpsForSector = (sectorId: string) => {
    const sector = snap?.sectors.find((s) => s.id === sectorId);
    if (!sector) return;
    const center = ringCentroid(sector.ring);
    setLiveLocation(center);
    setGpsFix({ sectorId, lat: center.lat, lng: center.lng });
    setLocationFocus((n) => n + 1);
    setError(null);
    showToast(`Demo: GPS bypassed for ${sector.name}`);
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

  // Open build tray when a building is being placed; keep arsenal clear otherwise
  useEffect(() => {
    if (
      placing &&
      placing.kind !== "house" &&
      placing.kind !== "villager"
    ) {
      setBuildOpen(true);
    }
  }, [placing]);

  // While choosing a sector, show the player's live GPS on the map
  useEffect(() => {
    if (claimed || !me || !navigator.geolocation || gpsWatchStarted.current) {
      return;
    }
    gpsWatchStarted.current = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLiveLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setLocationFocus((n) => n + 1);
      },
      () => {
        /* user can still tap Confirm later */
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15_000 }
    );

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setLiveLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 8_000, timeout: 20000 }
    );
    return () => {
      navigator.geolocation.clearWatch(watchId);
      gpsWatchStarted.current = false;
    };
  }, [claimed, me]);

  const handlePlace = async (lat: number, lng: number) => {
    if (!placing) return;
    // Block settle/rebuild while a full-screen save is in flight;
    // building places use optimistic sync and may run in parallel.
    const isBuildingPlace =
      placing.kind !== "house" && placing.kind !== "villager";
    if (!isBuildingPlace && busyRef.current) return;

    if (placing.kind === "house") {
      // Stash the house, then ask for the villager
      setPendingHouse({ lat, lng });
      setPlacing({ kind: "villager", sector: placing.sector });
      showToast("House set — now place your villager nearby");
      return;
    }

    if (placing.kind === "villager") {
      if (!pendingHouse) {
        setPlacing({ kind: "house", sector: placing.sector });
        return;
      }

      // Rebuild after house was destroyed (already own the sector)
      if (me?.homeSectorId === placing.sector.id) {
        const data = await act(
          "place_house",
          {
            lat: pendingHouse.lat,
            lng: pendingHouse.lng,
            villagerLat: lat,
            villagerLng: lng,
          },
          "Saving house…"
        );
        if (data) {
          playBuildSound();
          showToast("House rebuilt — villagers are gathering again");
          setPlacing(null);
          setPendingHouse(null);
        }
        return;
      }

      if (!gpsFix || gpsFix.sectorId !== placing.sector.id) {
        setError("Confirm your GPS location in this sector first");
        window.setTimeout(() => setError(null), 3200);
        setPlacing(null);
        setPendingHouse(null);
        return;
      }

      const data = await act(
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
        "Saving your settlement…"
      );
      if (data) {
        playBuildSound();
        showToast(`Settled in ${placing.sector.name} — your village is live!`);
        setPlacing(null);
        setPendingHouse(null);
        setGpsFix(null);
      }
      // On error stay in villager placement so they can adjust
      return;
    }

    // Building placement — show on the map immediately, sync in background
    if (!me || !snap) return;
    const kind = placing.kind as BuildingType;
    const cat =
      snap.buildingCatalog.find((b) => b.type === kind) ?? catalogItem(kind);
    if (displayGold < cat.cost) {
      setError(`Need ${GOLD_COIN}${cat.cost}`);
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
    setSyncingBuildIds((ids) => [...ids, tempId]);
    playBuildSound();

    const data = await act(
      "build",
      { buildingType: kind, lat, lng },
      undefined,
      { silent: true }
    );
    setSyncingBuildIds((ids) => ids.filter((id) => id !== tempId));
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
    showToast("Building synced");
  };

  const cancelPlacement = () => {
    setPlacing(null);
    setPendingHouse(null);
  };

  const switchPlayer = async (targetId?: string) => {
    // Force re-prime of battle events for the next identity
    meIdRef.current = null;
    eventsPrimed.current = false;
    seenEvents.current = new Set();
    setBattleSummary(null);
    const data = await act("switch_player", targetId ? { targetId } : {});
    if (data) {
      setShowPlayers(false);
      setPlacing(null);
      setPendingHouse(null);
      setMarch(null);
      const nextMe = (data as GameSnapshot).me;
      rememberIdentity(nextMe?.id);
      setSelectedId(
        nextMe?.homeSectorId || (data as GameSnapshot).sectors[0]?.id || null
      );
      showToast(`Now playing as ${nextMe?.name ?? "new settler"}`);
    }
  };

  const dismissBattle = useCallback(() => {
    writeBattleAck(Date.now());
    setBattleSummary(null);
  }, []);

  const dismissRazeAlert = useCallback(() => {
    if (razeAlert) {
      writeBattleAck(Math.max(readBattleAck(), razeAlert.ts));
    }
    setRazeAlert(null);
  }, [razeAlert]);

  // Corner toasts auto-dismiss after 7s
  useEffect(() => {
    if (!razeAlert) return;
    const t = window.setTimeout(dismissRazeAlert, 7000);
    return () => window.clearTimeout(t);
  }, [razeAlert, dismissRazeAlert]);

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
    const durationMs = 3200;
    const marchStarted = Date.now();
    setMarch({
      from: me.house,
      to: target,
      startedAt: marchStarted,
      durationMs,
    });
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
    // Report stays until the player closes it — never auto-dismisses.
    const remaining = Math.max(0, durationMs - (Date.now() - marchStarted));
    window.setTimeout(() => {
      setMarch(null);
      setImpact({ at: target, startedAt: Date.now() });
      window.setTimeout(() => setImpact(null), 1600);
      setBattleSummary(summary);
      setShowBattles(false);
    }, remaining);
  };

  const inviteLink =
    typeof window !== "undefined" && me?.inviteCode
      ? `${window.location.origin}/play?invite=${me.inviteCode}`
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

  const confirmRaze = async () => {
    if (!razeTarget || !razeBuilding || !razeOwner) return;
    const name = catalogItem(razeBuilding.type).name;
    const ownerName = razeOwner.name;
    const data = await act(
      "raze_building",
      {
        targetPlayerId: razeTarget.playerId,
        buildingId: razeTarget.buildingId,
      },
      "Clearing ground…"
    );
    if (!data) return;
    setRazeTarget(null);
    showToast(`Cleared ${ownerName}'s ${name} — ground is free`);
  };

  // Google auth required — gate the game until signed in
  if (snap && !snap.authDisabled && !me) {
    return (
      <main className="war-grid flex min-h-[100dvh] flex-col items-center justify-center px-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--ink-faint)]">
          Islamabad Territorial Wars
        </p>
        <h1 className="mt-2 font-display text-4xl text-[var(--ink)]">
          Sign in to play
        </h1>
        <p className="mt-2 max-w-sm text-center text-sm text-[var(--ink-muted)]">
          Your sector, arsenal, and battle reports stay tied to your Google
          account — no more lost guest progress.
        </p>
        <div className="mt-6">
          <GoogleSignInButton callbackUrl={inviteCallbackUrl()} />
        </div>
        <Link href="/" className="mt-8 text-xs text-[var(--ink-faint)]">
          Back
        </Link>
      </main>
    );
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
    setShowPlayers(false);
    setShowWalkthrough(true);
  };

  const startTutorialTest = async () => {
    setShowMenu(false);
    clearWalkthroughDone();
    walkthroughArmed.current = false;
    setShowWalkthrough(false);
    setPlacing(null);
    setPendingHouse(null);
    setGpsFix(null);
    lastGoodMe.current = null;
    settleGuardUntil.current = 0;
    const data = await act(
      "begin_tutorial_test",
      {},
      "Starting tutorial test…"
    );
    if (!data) return;
    // Brief close so Walkthrough remounts at welcome
    window.setTimeout(() => {
      walkthroughArmed.current = true;
      setShowWalkthrough(true);
    }, 80);
    showToast("Tutorial test — settle like a new account");
  };

  const stopTutorialTest = async () => {
    setShowWalkthrough(false);
    setPlacing(null);
    setPendingHouse(null);
    setGpsFix(null);
    const data = await act(
      "end_tutorial_test",
      {},
      "Restoring your account…"
    );
    if (!data) return;
    lastGoodMe.current = (data as GameSnapshot).me;
    const nextMe = (data as GameSnapshot).me;
    setSelectedId(
      nextMe?.homeSectorId || (data as GameSnapshot).sectors[0]?.id || null
    );
    showToast("Tutorial test ended — account restored");
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
          selectedId={selectedId}
          selectedPlayerId={selectedPlayerId}
          placing={placing}
          previewHouse={pendingHouse}
          userLocation={!claimed ? liveLocation : null}
          userLocationFocus={locationFocus}
          sectorFocus={sectorFocus}
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
                "Same sector — tap their building to clear ground for yours"
              );
              return;
            }
            setSelectedPlayerId(id);
          }}
          onSelectRaze={(target) => {
            setSelectedPlayerId(null);
            setRazeTarget(target);
          }}
          selectedRazeBuildingId={razeTarget?.buildingId ?? null}
          onPlace={(lat, lng) => void handlePlace(lat, lng)}
          onSpawnFind={(p) => spawnFind(p)}
          onCollectHidden={(spotId) => void act("collect_hidden", { spotId }).then((d) => {
            if (d?.gained) {
              playCoinSound();
              showToast(`Collected +${GOLD_COIN}${d.gained}`);
            }
          })}
          onSelectBusiness={(biz) => {
            setReviewBiz(biz);
            setReviewOpenedAt(null);
            setReviewReady(false);
            setSelectedPlayerId(null);
            setRazeTarget(null);
          }}
          onIntroComplete={() => {
            if (walkthroughArmed.current) return;
            walkthroughArmed.current = true;
            if (!readWalkthroughDone()) setShowWalkthrough(true);
          }}
          guidePulse={
            showWalkthrough &&
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

      {/* ---- Top bar (safe-area + wrap so chips aren't clipped) ---- */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex flex-wrap items-start justify-between gap-2 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-3 sm:pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto flex flex-col items-start gap-1.5">
          <Link
            href="/"
            className="hud-chip px-2.5 py-1.5 sm:px-3"
            title="Islamabad Territorial Wars"
          >
            <span className="font-display text-xs text-[var(--ink)] sm:text-sm">
              ITW
            </span>
            <span className="ml-1.5 font-mono text-[8px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
              {claimed ? homeName : "settle"}
            </span>
          </Link>
          {visitorId && (
            <PublicChat
              visitorId={visitorId}
              displayName={displayName || me?.name || "Scout"}
              onSent={noteLocalMessage}
              onRename={renamePresence}
              placement="top"
            />
          )}
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-1.5">
          <div className="flex max-w-[calc(100vw-5.5rem)] flex-wrap items-center justify-end gap-1.5 sm:max-w-none sm:gap-2">
            <div
              className="flex h-[31px] items-center gap-1 px-0.5 font-mono text-[11px] font-bold text-[#e8cf8a]"
              title={claimed ? `${Math.floor(displayGold)} gold · +${perTrip}/trip` : `${Math.floor(displayGold)} gold`}
            >
              <span aria-hidden className="text-[13px] leading-none">
                {GOLD_COIN}
              </span>
              <span className="leading-none tabular-nums">
                {Math.floor(displayGold)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowActivity(true);
                setShowMenu(false);
                setShowBattles(false);
                setShowRanks(false);
                setShowMissions(false);
                setShowInvite(false);
                setShowPlayers(false);
              }}
              className={`hud-chip px-2.5 py-1.5 font-mono text-[11px] sm:px-3 ${
                showActivity
                  ? "text-[var(--sand)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--sand)]"
              }`}
              title="Activity summary — world & your fights"
            >
              Log
            </button>
            <button
              type="button"
              data-nohover="1"
              onClick={() => setMusicOn(toggleMusic())}
              className={`hud-chip px-2.5 py-1.5 font-mono text-[11px] sm:px-3 ${
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
                  setShowPlayers(false);
                }}
                className={`hud-chip px-2.5 py-1.5 font-mono text-[11px] sm:px-3 ${
                  showInvite
                    ? "text-[var(--sand)]"
                    : "text-[var(--ink-muted)] hover:text-[var(--sand)]"
                }`}
                title="Invite friends — +1 villager each"
              >
                Invite
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
                setShowPlayers(false);
              }}
              className={`hud-chip px-2.5 py-1.5 font-mono text-[11px] sm:px-3 ${
                showMenu
                  ? "text-[var(--sand)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--sand)]"
              }`}
              title="Menu"
            >
              ☰
            </button>
          </div>

          {/* Minimal top-sectors board — row taps fly the camera */}
          <div className="sector-board pointer-events-auto w-[8.75rem] px-1.5 py-1.5 text-left sm:w-40">
            <div className="mb-0.5 flex items-center justify-between gap-1">
              <span className="font-mono text-[7px] uppercase tracking-[0.18em] text-white/55">
                Top sectors
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowRanks(true);
                  setShowMenu(false);
                  setShowBattles(false);
                  setShowMissions(false);
                  setShowInvite(false);
                  setShowPlayers(false);
                }}
                className="font-mono text-[7px] text-white/45 underline decoration-dotted underline-offset-2 hover:text-white/80"
                title="Open full sector leaderboard"
              >
                all
              </button>
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
                          setSelectedId(r.id);
                          setSectorFocus((n) => n + 1);
                          setSelectedPlayerId(null);
                          setRazeTarget(null);
                          setShowRanks(false);
                        }}
                        className={`sector-board-row w-full ${medal} ${
                          r.mine ? "is-mine" : ""
                        } ${selectedId === r.id ? "is-selected" : ""}`}
                        title={`Fly to ${r.name}`}
                      >
                        <span
                          className="sector-board-rank"
                          title={r.rank === 1 ? "Top sector" : undefined}
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
            onClick={openWalkthrough}
            className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-[12px] text-[var(--ink-muted)] hover:bg-[var(--wash)] hover:text-[var(--sand)]"
          >
            <span>? How to play</span>
          </button>
          {me && !snap?.tutorialTestActive && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startTutorialTest()}
              className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-[12px] text-[var(--ink-muted)] hover:bg-[var(--wash)] hover:text-[var(--sand)] disabled:opacity-40"
            >
              <span>🧪 Test new account</span>
            </button>
          )}
          {me && snap?.tutorialTestActive && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void stopTutorialTest()}
              className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-[12px] text-[var(--signal-bright)] hover:bg-[var(--wash)] disabled:opacity-40"
            >
              <span>⏹ End tutorial test</span>
            </button>
          )}
          {snap?.authDisabled && (
            <button
              type="button"
              onClick={() => {
                setShowMenu(false);
                setShowPlayers(true);
              }}
              className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-[12px] text-[var(--ink-muted)] hover:bg-[var(--wash)] hover:text-[var(--sand)]"
            >
              <span>👤 Switch player</span>
            </button>
          )}
          <Link
            href="/edit"
            className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-[12px] text-[var(--ink-muted)] hover:bg-[var(--wash)] hover:text-[var(--sand)]"
            onClick={() => setShowMenu(false)}
          >
            <span>✎ Map editor</span>
          </Link>
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
                    {new Date(e.ts).toLocaleTimeString()}
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

      {/* Player switcher (testing) */}
      {showPlayers && (
        <div className="absolute right-2 top-[4.75rem] z-30 w-72 hud-panel p-3 sm:right-3 sm:top-16">
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              Switch player · test accounts
            </h2>
            <button
              type="button"
              onClick={() => setShowPlayers(false)}
              className="font-mono text-[11px] text-[var(--ink-faint)] hover:text-[var(--sand)]"
            >
              ✕
            </button>
          </div>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {(snap?.players ?? [])
              .filter((p) => p.id.startsWith("guest_"))
              .map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={busy || p.id === me?.id}
                    onClick={() => void switchPlayer(p.id)}
                    className={`flex w-full items-center justify-between rounded-sm border px-2 py-1.5 text-left text-[11px] ${
                      p.id === me?.id
                        ? "border-[var(--sand)] text-[var(--sand)]"
                        : "border-[var(--line)] text-[var(--ink-muted)] hover:border-[var(--sand)]"
                    }`}
                  >
                    <span>
                      {p.name}
                      {p.id === me?.id ? " (you)" : ""}
                      <span className="block text-[9px] text-[var(--ink-faint)]">
                        {snap?.sectors.find((s) => s.id === p.homeSectorId)
                          ?.name ?? "no sector"}{" "}
                        · {GOLD_COIN} {p.gold} · {p.rockets || 0}🚀
                      </span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={() => void switchPlayer()}
            className="mt-2 w-full rounded-sm bg-[var(--field)] px-2 py-1.5 text-xs font-semibold text-white"
          >
            ＋ New test player
          </button>
          <p className="mt-1.5 text-[9px] leading-snug text-[var(--ink-faint)]">
            Open a second browser window and pick a different player there to
            fight yourself.
          </p>
        </div>
      )}

      {/* Full sector leaderboard modal */}
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
            aria-label="Sector leaderboard"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl text-[var(--ink)]">
                  Sector leaderboard
                </h2>
                <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                  Total resources farmed
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRanks(false)}
                className="font-mono text-[14px] text-[var(--ink-faint)] hover:text-[var(--sand)]"
              >
                ✕
              </button>
            </div>
            <ol className="mt-3 max-h-[min(60dvh,28rem)] space-y-1.5 overflow-y-auto pr-1">
              {sectorRanking.length === 0 && (
                <li className="text-[12px] text-[var(--ink-faint)]">
                  No sectors yet
                </li>
              )}
              {sectorRanking.map((r, i) => {
                const mine = me?.homeSectorId === r.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(r.id);
                        setSectorFocus((n) => n + 1);
                        setSelectedPlayerId(null);
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
                        <span className="ml-1.5 font-mono text-[9px] text-[var(--ink-faint)]">
                          {r.settlers} settler{r.settlers === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono font-semibold text-[#e8cf8a]">
                        {GOLD_COIN} {r.farmed}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
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
          {inviteLink && (
            <p className="mt-2 break-all rounded-sm bg-[var(--wash)] px-2 py-1.5 font-mono text-[9px] text-[var(--ink-muted)]">
              {inviteLink}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-sm bg-[var(--signal)] px-2 py-2 text-[12px] font-bold text-white"
              onClick={() => void shareInvite()}
            >
              Share link
            </button>
            <button
              type="button"
              className="rounded-sm border border-[var(--line-strong)] px-3 py-2 font-mono text-[10px] text-[var(--sand)]"
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
        </div>
      )}

      <Walkthrough
        open={showWalkthrough}
        onClose={() => setShowWalkthrough(false)}
        ctx={{
          claimed,
          gpsReady: Boolean(
            selected && gpsFix?.sectorId === selected.id
          ),
          placingKind: placing?.kind ?? null,
          sectorName:
            selected?.name ??
            (me?.homeSectorId
              ? snap?.sectors.find((s) => s.id === me.homeSectorId)?.name ??
                null
              : null),
        }}
      />

      {/* Always-visible exit while testing the new-account tutorial */}
      {snap?.tutorialTestActive && (
        <div className="pointer-events-none absolute left-1/2 top-[max(3.75rem,calc(env(safe-area-inset-top)+3.25rem))] z-[45] w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2">
          <div className="pointer-events-auto flex items-center justify-between gap-2 rounded-sm border border-[var(--sand)]/50 bg-[rgba(12,16,14,0.92)] px-3 py-2 shadow-lg">
            <p className="min-w-0 font-mono text-[10px] text-[var(--sand)]">
              Tutorial test · dummy new account
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void stopTutorialTest()}
              className="shrink-0 rounded-sm bg-[var(--signal)] px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-40"
            >
              End test
            </button>
          </div>
        </div>
      )}

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
                </p>
                <p className="font-display text-xl leading-tight text-white sm:text-2xl">
                  {battleSummary.headline}
                </p>
                <p className="mt-1 text-[12px] leading-snug text-white/90">
                  {battleSummary.role === "attacker" ? (
                    <>
                      You hit <strong>{battleSummary.opponent}</strong>
                      {"'s village in "}
                      {battleSummary.sectorName}
                    </>
                  ) : (
                    <>
                      <strong>{battleSummary.opponent}</strong>
                      {" hit your village in "}
                      {battleSummary.sectorName}
                    </>
                  )}
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
                <span className="battle-stat-lbl">Lost</span>
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
                    ? "Their house was razed — they must rebuild"
                    : "Your house was razed — rebuild to gather"
                  : battleSummary.role === "attacker"
                    ? "Their house was damaged"
                    : "Your house was damaged"}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Saving settlement / build — blocks accidental taps while write is in flight */}
      {savingLabel && (
        <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/35 px-4 pb-28 sm:items-center sm:pb-0">
          <div className="hud-panel w-full max-w-xs p-4 text-center">
            <p className="font-display text-lg text-[var(--sand)]">{savingLabel}</p>
            <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
              Hold on — writing your village to the server…
            </p>
            <div className="mx-auto mt-3 h-1 w-32 overflow-hidden rounded-full bg-[var(--wash)]">
              <div className="h-full w-1/2 animate-pulse bg-[var(--sand)]" />
            </div>
          </div>
        </div>
      )}

      {/* Google Maps business review → +villager */}
      {reviewBiz && claimed && (
        <div
          className="absolute inset-x-2 bottom-[max(6.5rem,calc(env(safe-area-inset-bottom)+5.5rem))] z-30 sm:inset-x-auto sm:bottom-auto sm:left-3 sm:top-[max(4.5rem,calc(env(safe-area-inset-top)+3.75rem))] sm:w-[min(20rem,calc(100%-1.5rem))]"
        >
          <div className="hud-panel pointer-events-auto p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-[var(--sand)]">
                  Local business
                </p>
                <p className="truncate font-display text-lg text-[var(--ink)]">
                  {reviewBiz.name}
                </p>
                {reviewBiz.address && (
                  <p className="mt-0.5 line-clamp-2 text-[10px] text-[var(--ink-muted)]">
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
            <p className="mt-2 text-[11px] leading-snug text-[var(--ink-muted)]">
              Leave a Google Maps review for this place in your sector and earn{" "}
              <span className="text-[var(--sand)]">
                +{REVIEW_VILLAGER_BONUS} villager
              </span>
              .
            </p>
            {me?.reviewedPlaceIds?.includes(reviewBiz.placeKey) ? (
              <p className="mt-3 rounded-sm border border-[var(--field)] bg-[var(--wash)] px-2.5 py-2 text-center text-[11px] text-[var(--field-bright)]">
                Already claimed — thanks for supporting local
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-1.5">
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
                  className="w-full rounded-sm bg-[var(--field)] px-3 py-2.5 text-sm font-bold text-white"
                >
                  Open in Google Maps
                </button>
                <button
                  type="button"
                  disabled={busy || !reviewReady}
                  onClick={() => {
                    void act("claim_business_review", {
                      placeKey: reviewBiz.placeKey,
                      placeName: reviewBiz.name,
                      lat: reviewBiz.lat,
                      lng: reviewBiz.lng,
                    }).then((d) => {
                      if (!d) return;
                      playRecruitSound();
                      showToast(
                        `Review claimed — +${REVIEW_VILLAGER_BONUS} villager!`
                      );
                      setReviewBiz(null);
                      setReviewOpenedAt(null);
                      setReviewReady(false);
                    });
                  }}
                  className="w-full rounded-sm border border-[var(--line-strong)] bg-[var(--wash)] px-3 py-2 text-xs font-semibold text-[var(--sand)] disabled:opacity-40"
                  title={
                    reviewOpenedAt == null
                      ? "Open Google Maps and leave a review first"
                      : reviewReady
                        ? "Claim your villager"
                        : "Finish your review, then claim"
                  }
                >
                  {reviewOpenedAt == null
                    ? "I left a review — claim villager"
                    : reviewReady
                      ? `Claim +${REVIEW_VILLAGER_BONUS} villager`
                      : "Leave your review…"}
                </button>
              </div>
            )}
          </div>
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

      {/* Placement cancel */}
      {placing && !savingLabel && (
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

      {/* ---- Settle prompt (no home yet) ---- */}
      {!claimed && selected && !placing && (
        <div className="absolute bottom-28 left-1/2 z-20 w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 sm:bottom-8">
          <div className="hud-panel p-4 text-center">
            <p className="font-display text-2xl text-[var(--ink)]">
              {selected.name}
            </p>
            <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
              {settlersHere.length > 0
                ? `${settlersHere.length} settler${settlersHere.length === 1 ? "" : "s"} here — sectors are shared, join them.`
                : "Sectors are shared. Confirm GPS, then place your house."}
            </p>
            {settlersHere.length > 0 && (
              <p className="mt-1 text-[10px] text-[var(--sand)]">
                {settlersHere.map((p) => p.name).join(" · ")}
              </p>
            )}
            {liveLocation && (
              <p className="mt-1 font-mono text-[9px] text-[#9fd0ff]">
                {pointInOrNearRing(liveLocation, selected.ring, 120)
                  ? `Blue pin is inside ${selected.name}`
                  : `Blue pin is outside ${selected.name} — move closer`}
              </p>
            )}
            <>
              <button
                type="button"
                data-guide="guide-gps"
                disabled={busy || !me || gpsBusy}
                onClick={() => confirmGpsForSector(selected.id)}
                className={`mt-3 w-full rounded-sm px-3 py-2.5 text-sm font-bold shadow-[0_2px_8px_rgba(0,0,0,0.5)] disabled:opacity-40 ${
                  gpsFix?.sectorId === selected.id
                    ? "bg-[var(--field)] text-white"
                    : "bg-[var(--wash)] text-[var(--ink)] border border-[var(--line-strong)]"
                }`}
              >
                {gpsBusy
                  ? "Reading GPS…"
                  : gpsFix?.sectorId === selected.id
                    ? "✓ Location confirmed"
                    : liveLocation
                      ? "📍 Confirm this pin to settle"
                      : "📍 Show my location"}
              </button>
              <button
                type="button"
                data-guide="guide-settle"
                disabled={busy || !me || gpsFix?.sectorId !== selected.id}
                onClick={() => {
                  setPendingHouse(null);
                  setPlacing({ kind: "house", sector: selected });
                  showToast("Tap the map to place your house");
                }}
                className="mt-2 w-full rounded-sm bg-[var(--signal)] px-3 py-2.5 text-sm font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.5)] disabled:opacity-40"
              >
                ⚑ Settle in {selected.name} — place house
              </button>
              <button
                type="button"
                disabled={busy || !me}
                onClick={() => bypassGpsForSector(selected.id)}
                className="mt-1.5 text-[9px] font-mono text-[var(--ink-faint)] underline decoration-dotted underline-offset-2 hover:text-[var(--sand)] disabled:opacity-40"
                title="Demo only — skips the GPS check"
              >
                Demo: bypass location check
              </button>
            </>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {(snap?.sectors ?? []).map((s) => {
                const n = settlersBySector.get(s.id)?.length ?? 0;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(s.id);
                      setSelectedPlayerId(null);
                      if (gpsFix && gpsFix.sectorId !== s.id) setGpsFix(null);
                    }}
                    className={`rounded-sm border px-2 py-1 font-mono text-[9px] ${
                      s.id === selectedId
                        ? "border-[var(--sand)] text-[var(--sand)]"
                        : "border-[var(--line)] text-[var(--ink-muted)]"
                    }`}
                  >
                    {s.name}
                    {n > 0 ? ` · ${n}` : ""}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ---- Rebuild house after it was destroyed ---- */}
      {needsHouseRebuild && me?.homeSectorId && !placing && (
        <div
          className={`absolute left-1/2 z-20 w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 sm:bottom-8 ${
            buildOpen ? "bottom-56" : "bottom-28"
          }`}
        >
          <div className="hud-panel p-4 text-center">
            <p className="font-display text-xl text-[var(--signal-bright)]">
              House destroyed
            </p>
            <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
              Gathering is paused. Rebuild your house in {homeName} to continue.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const sector = snap?.sectors.find(
                  (s) => s.id === me.homeSectorId
                );
                if (!sector) return;
                setSelectedId(sector.id);
                setPendingHouse(null);
                setPlacing({ kind: "house", sector });
                showToast("Tap the map to rebuild your house");
              }}
              className="mt-3 w-full rounded-sm bg-[var(--signal)] px-3 py-2.5 text-sm font-bold text-white disabled:opacity-40"
            >
              🏠 Rebuild house
            </button>
          </div>
        </div>
      )}

      {/* ---- Clear ground: same-sector neighbor building ---- */}
      {canRazeSelected && razeOwner && razeBuilding && !placing && (
        <div
          className={`absolute left-1/2 z-20 w-[calc(100%-1.5rem)] max-w-xs -translate-x-1/2 sm:bottom-8 ${
            buildOpen ? "bottom-56" : "bottom-28"
          }`}
        >
          <div className="hud-panel p-3 text-center">
            <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-[var(--sand)]">
              Clear ground
            </p>
            <p className="mt-1 font-display text-lg text-[var(--ink)]">
              {catalogItem(razeBuilding.type).name}
            </p>
            <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
              Destroy <strong className="text-[var(--ink)]">{razeOwner.name}</strong>
              &apos;s building so you can plant yours on this spot. They&apos;ll
              be notified.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void confirmRaze()}
              className="mt-3 w-full rounded-sm bg-[var(--signal)] px-3 py-2.5 text-sm font-bold text-white disabled:opacity-40"
            >
              Break building
            </button>
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
                </p>
                <p className="font-display text-xl leading-tight text-white sm:text-2xl">
                  Building lost
                </p>
                <p className="mt-1.5 text-[13px] leading-snug text-white/90">
                  Your ally, <strong>{personName(razeAlert.attackerName)}</strong>,
                  destroyed your{" "}
                  <strong>{razeAlert.buildingName}</strong>
                  {razeAlert.sectorName ? ` in ${razeAlert.sectorName}` : ""}.
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
                      {isRazeEvent(e) ? "Sabotage" : "Attack"} ·{" "}
                      {new Date(e.ts).toLocaleString()}
                    </p>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}

      {/* ---- Attack panel: after tapping any enemy building/house ---- */}
      {enemySelected && enemyPlayer && !placing && !needsHouseRebuild && (
        <div
          className={`absolute left-1/2 z-20 w-[calc(100%-1.5rem)] max-w-xs -translate-x-1/2 sm:bottom-8 ${
            buildOpen ? "bottom-[13.5rem]" : "bottom-28"
          }`}
        >
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
                (me.rockets || 0) <= 0 ||
                Boolean(march)
              }
              onClick={() => void launchAttack()}
              className="mt-2 w-full rounded-sm bg-[var(--signal)] px-3 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              ✦ Fire {salvo} rocket{salvo === 1 ? "" : "s"}
            </button>
            <button
              type="button"
              className="mt-1.5 text-[9px] font-mono text-[var(--ink-faint)] underline decoration-dotted"
              onClick={() => setSelectedPlayerId(null)}
            >
              Cancel target
            </button>
            {me && (me.rockets || 0) <= 0 && (
              <p className="mt-1 text-[9px] text-[var(--ink-faint)]">
                Stock rockets in Arsenal first
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---- Bottom dock: status + Arsenal (weapons) + Buildables ---- */}
      {claimed && me && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-3 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
            {/* Left: villager/house status + arsenal */}
            <div className="order-2 flex min-w-0 max-w-full flex-col items-start gap-1 sm:order-1 sm:max-w-[min(100%,28rem)]">
              <div className="hud-status pointer-events-auto">
                <div
                  className="hud-status-chip"
                  title={`${me.villagers} villager(s) gathering`}
                >
                  <VillagerSprite walking className="h-5 w-5" />
                  <span>×{me.villagers}</span>
                </div>
                <div
                  className={`hud-status-chip ${
                    me.house ? "hud-status-chip--hp" : "hud-status-chip--down"
                  }`}
                  title={
                    me.house
                      ? `House health ${me.houseHp}/${HOUSE_MAX_HP}`
                      : "House destroyed — rebuild to gather"
                  }
                >
                  <HouseSprite className="h-5 w-6" />
                  <span>
                    {me.house ? `${me.houseHp}/${HOUSE_MAX_HP}` : "✕"}
                  </span>
                </div>
                <div
                  className="hud-status-chip"
                  title={`Arsenal: ${me.rockets || 0} rocket(s) · ${myAttack} attack power`}
                >
                  <RocketSprite className="h-5 w-5" />
                  <span>×{me.rockets || 0}</span>
                </div>
                {gemsFound > 0 && (
                  <div
                    className="hud-status-chip"
                    title={`${gemsFound} resource site(s) found`}
                  >
                    <ResourceGem gem="diamond" size={16} pulse />
                    <span>×{gemsFound}</span>
                  </div>
                )}
              </div>

              <div className="pointer-events-auto w-full min-w-0">
                <div className="hud-panel hud-panel-arsenal p-1.5 sm:p-2">
                  <div className="flex items-end justify-between gap-2 px-1 pb-1">
                    <div className="min-w-0">
                      <p className="font-mono text-[8px] uppercase tracking-[0.24em] text-[var(--sand)]">
                        Arsenal
                      </p>
                      <p className="hidden font-mono text-[8px] text-[var(--ink-faint)] sm:block">
                        Stock rockets · spend on attacks
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-[9px] text-[var(--ink-muted)]">
                      Atk {myAttack} · Def {myDefense}
                    </p>
                  </div>
                  <div className="flex items-end gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:gap-1.5 [&::-webkit-scrollbar]:hidden">
                    <button
                      type="button"
                      className={`cameo ${
                        displayGold >= ROCKET_COST && me.house
                          ? "cameo-blink"
                          : ""
                      }`}
                      disabled={busy || displayGold < ROCKET_COST || !me.house}
                      title={
                        !me.house
                          ? "Rebuild your house first"
                          : `Buy rocket — ${GOLD_COIN}${ROCKET_COST} · +1 attack (expended when you fire)`
                      }
                      onClick={() =>
                        void act("buy_rocket").then((d) => {
                          if (d) {
                            playRecruitSound();
                            showToast("Rocket stocked · +1 attack");
                          }
                        })
                      }
                    >
                      <RocketSprite className="h-8 w-8 sm:h-9 sm:w-9" />
                      <span className="cameo-cost">
                        {GOLD_COIN}
                        {ROCKET_COST}
                      </span>
                      <span className="cameo-label">Buy +1</span>
                    </button>

                    <button
                      type="button"
                      className={`cameo ml-auto sm:hidden ${
                        buildOpen ? "cameo-active" : ""
                      }`}
                      title="Open buildables — place structures"
                      onClick={() => setBuildOpen((o) => !o)}
                    >
                      <HammerSprite className="h-7 w-7" />
                      <span className="cameo-label">
                        {buildOpen ? "Close" : "Build"}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Buildables — place structures (separate from arsenal) */}
            <div
              className={`pointer-events-auto order-1 w-full sm:order-2 sm:w-auto sm:max-w-[17rem] ${
                buildOpen ? "block" : "hidden sm:block"
              }`}
            >
              <div className="hud-panel hud-panel-build p-1.5 sm:p-2">
                <div className="flex items-center justify-between gap-2 px-1 pb-1">
                  <div className="min-w-0">
                    <p className="font-mono text-[8px] uppercase tracking-[0.24em] text-[#8fe098]">
                      Buildables
                    </p>
                    <p className="hidden font-mono text-[8px] text-[var(--ink-faint)] sm:block">
                      Place structures in your sector
                    </p>
                  </div>
                  <button
                    type="button"
                    className="font-mono text-[9px] text-[var(--ink-faint)] underline decoration-dotted sm:hidden"
                    onClick={() => {
                      setBuildOpen(false);
                      setPlacing((cur) =>
                        cur && cur.kind !== "house" && cur.kind !== "villager"
                          ? null
                          : cur
                      );
                    }}
                  >
                    Close
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5 sm:gap-1.5">
                  {(snap?.buildingCatalog ?? []).map((b) => {
                    const affordable = displayGold >= b.cost;
                    const active = placing?.kind === b.type;
                    const homeSector = snap?.sectors.find(
                      (s) => s.id === me.homeSectorId
                    );
                    return (
                      <button
                        key={b.type}
                        type="button"
                        className={`cameo cameo-build ${
                          active ? "cameo-active" : ""
                        } ${affordable && !active ? "cameo-blink" : ""}`}
                        disabled={
                          busy || !affordable || !homeSector || !me.house
                        }
                        title={
                          !me.house
                            ? "Rebuild your house first"
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
                          className="h-9 w-10 sm:h-9 sm:w-10"
                        />
                        <span className="cameo-cost">
                          {GOLD_COIN}
                          {b.cost}
                        </span>
                        <span className="cameo-label">{b.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
