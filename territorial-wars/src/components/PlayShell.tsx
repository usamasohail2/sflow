"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GameMap,
  type ImpactAnim,
  type MarchAnim,
  type Placing,
} from "@/components/GameMap";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import type { LatLng } from "@/lib/gameTypes";
import {
  HouseSprite,
  MillSprite,
  SoldierSprite,
  TankSprite,
  TurretSprite,
  VillagerSprite,
  WarehouseSprite,
  WellSprite,
} from "@/components/sprites";
import { ResourceGem } from "@/components/ResourceGem";
import type {
  BattleReport,
  BuildingType,
  GameEvent,
  GameSnapshot,
  Player,
} from "@/lib/gameTypes";
import {
  HOUSE_MAX_HP,
  SOLDIER_COST,
  TANK_COST,
  attackBreakdown,
  attackPower,
  buildingBonus,
  defenseBreakdown,
  defensePower,
} from "@/lib/gameTypes";
import { pointInOrNearRing } from "@/lib/geo";
import { ringCentroid } from "@/lib/mapMath";
import {
  isMusicOn,
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

type BattleSummary = {
  id: string;
  role: "attacker" | "defender";
  headline: string;
  sectorName: string;
  opponent: string;
  win: boolean;
  rows: string[];
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

function summaryFromAttack(
  battle: BattleReport,
  sectorName: string,
  defenderName: string,
  id = `atk_${Date.now()}`
): BattleSummary {
  const losses = [
    battle.soldiersLost > 0 ? `${battle.soldiersLost} soldier(s)` : null,
    battle.tanksLost > 0 ? `${battle.tanksLost} tank(s)` : null,
  ]
    .filter(Boolean)
    .join(" + ");
  const rows = [
    battle.attackPower > 0 || battle.defensePower > 0
      ? `Attack ${battle.attackPower} vs Defense ${battle.defensePower}`
      : null,
    battle.damage > 0
      ? `Dealt ${battle.damage} damage`
      : "No structure damage",
    battle.houseDestroyed
      ? "Their house was destroyed — they must rebuild"
      : battle.houseDamaged
        ? "Their house was damaged"
        : null,
    battle.destroyed ? `Destroyed: ${battle.destroyed}` : null,
    battle.damagedBuildings.length
      ? `Damaged: ${battle.damagedBuildings.join(", ")}`
      : null,
    battle.defenderSoldiersLost > 0
      ? `Enemy lost ${battle.defenderSoldiersLost} soldier(s)`
      : null,
    battle.lootedGold > 0 ? `Looted +${battle.lootedGold}g` : null,
    losses ? `Your losses: ${losses}` : null,
  ].filter(Boolean) as string[];

  return {
    id,
    role: "attacker",
    headline: battle.win ? "Victory" : "Repelled",
    sectorName,
    opponent: defenderName,
    win: battle.win,
    rows,
  };
}

function summaryFromEvent(e: GameEvent, asDefender = true): BattleSummary {
  if (!asDefender) {
    return summaryFromAttack(
      {
        win: e.win,
        attackPower: e.attackPower ?? 0,
        defensePower: e.defensePower ?? 0,
        damage: e.damage,
        destroyed: e.destroyed,
        damagedBuildings: e.damagedBuildings ?? [],
        houseDestroyed: Boolean(e.houseDestroyed),
        houseDamaged: Boolean(e.houseDamaged),
        lootedGold: e.lootedGold,
        soldiersLost: e.soldiersLost ?? 0,
        tanksLost: e.tanksLost ?? 0,
        defenderSoldiersLost: e.defenderSoldiersLost,
      },
      e.sectorName,
      e.defenderName,
      e.id
    );
  }

  const rows = [
    e.attackPower != null && e.defensePower != null
      ? `Attack ${e.attackPower} vs Defense ${e.defensePower}`
      : null,
    e.damage > 0 ? `Took ${e.damage} damage` : "No structure damage",
    e.houseDestroyed
      ? "Your house was destroyed — rebuild it to gather again"
      : e.houseDamaged
        ? "Your house was damaged"
        : null,
    e.destroyed ? `Destroyed: ${e.destroyed}` : null,
    e.damagedBuildings?.length
      ? `Damaged: ${e.damagedBuildings.join(", ")}`
      : null,
    e.defenderSoldiersLost > 0
      ? `Lost ${e.defenderSoldiersLost} soldier(s)`
      : null,
    e.lootedGold > 0 ? `${e.lootedGold}g looted` : null,
    e.win ? "Enemy broke through" : "Your defenses held",
  ].filter(Boolean) as string[];

  return {
    id: e.id,
    role: "defender",
    headline: e.win ? "Under attack — breach" : "Under attack — held",
    sectorName: e.sectorName,
    opponent: e.attackerName,
    win: !e.win,
    rows,
  };
}

function eventLogLine(e: GameEvent, myId: string | undefined): string {
  const asAttacker = e.attackerId === myId;
  if (asAttacker) {
    return `${e.win ? "Won" : "Lost"} vs ${e.defenderName} @ ${e.sectorName} · ${e.damage} dmg`;
  }
  return `${e.attackerName} hit ${e.sectorName} · ${e.damage} dmg · ${e.win ? "breached" : "held"}`;
}

export function PlayShell() {
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  /** Shown while a settle/rebuild/build write is in flight */
  const [savingLabel, setSavingLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [displayGold, setDisplayGold] = useState(0);
  const [showMissions, setShowMissions] = useState(false);
  const [showRanks, setShowRanks] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  const [showBattles, setShowBattles] = useState(false);
  const [placing, setPlacing] = useState<Placing | null>(null);
  /** Mobile: build tray collapsed by default so it doesn't stack over the army row */
  const [buildOpen, setBuildOpen] = useState(false);
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
  const [musicOn, setMusicOn] = useState(false);
  const gpsWatchStarted = useRef(false);
  const identityChecked = useRef(false);
  const seenEvents = useRef<Set<string>>(new Set());
  const eventsPrimed = useRef(false);
  const meIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const settleGuardUntil = useRef(0);
  const lastGoodMe = useRef<Player | null>(null);

  const IDENT_KEY = "itw_player_id";

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
    }

    const events = next.events ?? [];
    if (!eventsPrimed.current) {
      for (const e of events) seenEvents.current.add(e.id);
      eventsPrimed.current = true;
      // Unacknowledged hits on this account — stay until dismissed
      const ack = typeof window !== "undefined" ? readBattleAck() : 0;
      const pendingHit = [...events]
        .reverse()
        .find(
          (e) => next.me && e.defenderId === next.me.id && e.ts > ack
        );
      if (pendingHit) {
        setBattleSummary(summaryFromEvent(pendingHit));
      }
      return;
    }
    for (const e of events) {
      if (seenEvents.current.has(e.id)) continue;
      seenEvents.current.add(e.id);
      if (next.me && e.defenderId === next.me.id) {
        const summary = summaryFromEvent(e);
        playUnderAttackSound();
        if (next.me.house) {
          setImpact({ at: next.me.house, startedAt: Date.now() });
          window.setTimeout(() => setImpact(null), 1600);
        }
        // Show after the hit lands — stays until they close it
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
    const invite =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("invite")
        : null;
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
  const claimed = Boolean(me?.homeSectorId);
  const needsHouseRebuild = Boolean(claimed && me && !me.house);
  const homeName =
    snap?.sectors.find((s) => s.id === me?.homeSectorId)?.name ?? null;
  const myAttack = me ? attackPower(me.soldiers, me.tanks || 0) : 0;
  const myDefense = me
    ? defensePower({
        soldiers: me.soldiers,
        tanks: me.tanks,
        buildings: me.buildings,
        house: me.house,
        houseHp: me.houseHp,
      })
    : 0;
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
        soldiers: enemyPlayer.soldiers,
        tanks: enemyPlayer.tanks,
        buildings: enemyPlayer.buildings,
        house: enemyPlayer.house,
        houseHp: enemyPlayer.houseHp,
      })
    : 0;

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
        id: "army",
        label: "Recruit a soldier",
        done: me.soldiers >= 1,
      },
    ];
  }, [me, gemsFound]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3400);
  };

  const act = async (
    action: string,
    extra: Record<string, unknown> = {},
    label?: string
  ) => {
    setBusy(true);
    busyRef.current = true;
    if (label) setSavingLabel(label);
    setError(null);
    try {
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sectorId: selectedId, ...extra }),
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
      setBusy(false);
      busyRef.current = false;
      setSavingLabel(null);
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
          ? `${gem[0].toUpperCase()}${gem.slice(1)} found ahead! +${data.bonus}g`
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

  // Audio: unlock on first tap (mobile autoplay) and resume music pref
  useEffect(() => {
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

  // Open build tray when a building is being placed; keep army row clear otherwise
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
    if (!placing || busyRef.current) return;

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

    // Building placement
    const data = await act(
      "build",
      {
        buildingType: placing.kind,
        lat,
        lng,
      },
      "Saving building…"
    );
    if (data) {
      playBuildSound();
      showToast("Building placed");
      setPlacing(null);
    }
    // On error keep placement mode so they can pick a clear spot
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

  const dismissBattle = () => {
    writeBattleAck(Date.now());
    setBattleSummary(null);
  };

  const launchAttack = async () => {
    if (!me?.house || !enemyPlayer?.house) return;
    const targetSector =
      snap?.sectors.find((s) => s.id === enemyPlayer.homeSectorId) ?? null;
    const defenderName = enemyPlayer.name;
    const target = enemyPlayer.house;
    const durationMs = 3200;
    const marchStarted = Date.now();
    setMarch({
      from: me.house,
      to: target,
      startedAt: marchStarted,
      durationMs,
    });
    playAttackSound();
    const data = await act("attack", { targetPlayerId: enemyPlayer.id });
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
  /** Attack modal only after tapping an enemy house */
  const enemySelected = claimed && canAttackEnemy;

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
          Your sector, army, and battle reports stay tied to your Google
          account — no more lost guest progress.
        </p>
        <div className="mt-6">
          <GoogleSignInButton callbackUrl="/play" />
        </div>
        <Link href="/" className="mt-8 text-xs text-[var(--ink-faint)]">
          Back
        </Link>
      </main>
    );
  }

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
          march={march}
          impact={impact}
          onSelect={(id) => {
            setSelectedId(id);
            // Sector taps never open attack UI — only houses do
            setSelectedPlayerId(null);
          }}
          onSelectPlayer={(id) => {
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
              showToast("Can't attack settlers in your own sector");
              return;
            }
            setSelectedPlayerId(id);
          }}
          onPlace={(lat, lng) => void handlePlace(lat, lng)}
          onSpawnFind={(p) => spawnFind(p)}
          onCollectHidden={(spotId) => void act("collect_hidden", { spotId }).then((d) => {
            if (d?.gained) {
              playCoinSound();
              showToast(`Collected +${d.gained} gold`);
            }
          })}
          className="h-full w-full"
        />
      </div>

      {/* ---- Top bar (safe-area + wrap so chips aren't clipped) ---- */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex flex-wrap items-start justify-between gap-2 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-3 sm:pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Link
          href="/"
          className="pointer-events-auto hud-chip px-2.5 py-1.5 sm:px-3"
          title="Islamabad Territorial Wars"
        >
          <span className="font-display text-xs text-[var(--ink)] sm:text-sm">
            ITW
          </span>
          <span className="ml-1.5 font-mono text-[8px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            {claimed ? homeName : "settle"}
          </span>
        </Link>

        <div className="pointer-events-auto flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="hud-chip px-2.5 py-1.5 sm:px-3">
              <p className="hud-gold font-mono text-sm font-bold text-[#e8cf8a] sm:text-base">
                ⛃ {Math.floor(displayGold)}
              </p>
              {claimed && (
                <p className="text-right font-mono text-[8px] text-[var(--ink-faint)]">
                  +{perTrip}/trip
                </p>
              )}
            </div>
            <button
              type="button"
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
            <button
              type="button"
              onClick={() => {
                setShowMenu((v) => !v);
                setShowBattles(false);
                setShowRanks(false);
                setShowMissions(false);
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

          {/* Top 5 sector leaderboard — tap for full list */}
          <button
            type="button"
            onClick={() => {
              setShowRanks(true);
              setShowMenu(false);
              setShowBattles(false);
              setShowMissions(false);
              setShowPlayers(false);
            }}
            className="hud-panel w-[11.5rem] px-2.5 py-2 text-left sm:w-56"
            title="Open full sector leaderboard"
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                🏆 Top sectors
              </span>
              <span className="font-mono text-[8px] text-[var(--sand)]">
                all →
              </span>
            </div>
            {topSectors.length === 0 ? (
              <p className="text-[10px] text-[var(--ink-faint)]">No farms yet</p>
            ) : (
              <ol className="space-y-0.5">
                {topSectors.map((r, i) => {
                  const mine = me?.homeSectorId === r.id;
                  return (
                    <li
                      key={r.id}
                      className={`flex items-center justify-between gap-2 font-mono text-[10px] sm:text-[11px] ${
                        mine ? "text-[var(--sand)]" : "text-[var(--ink-muted)]"
                      }`}
                    >
                      <span className="min-w-0 truncate">
                        <span className="text-[var(--ink-faint)]">
                          {i === 0
                            ? "①"
                            : i === 1
                              ? "②"
                              : i === 2
                                ? "③"
                                : i === 3
                                  ? "④"
                                  : "⑤"}
                        </span>{" "}
                        <strong className="font-semibold text-[var(--ink)]">
                          {r.name}
                        </strong>
                      </span>
                      <span className="shrink-0 text-[var(--ink-faint)]">
                        {r.farmed}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </button>
        </div>
      </div>

      {/* Menu dropdown — battles / ranks / goals / editor / account */}
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
              setShowRanks(true);
            }}
            className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-[12px] text-[var(--ink-muted)] hover:bg-[var(--wash)] hover:text-[var(--sand)]"
          >
            <span>🏆 Sector leaderboard</span>
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
          {(snap?.events ?? []).length === 0 ? (
            <p className="mt-2 text-[11px] text-[var(--ink-faint)]">
              No attacks yet. Raid a rival sector to see a report here.
            </p>
          ) : (
            <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
              {[...(snap?.events ?? [])].reverse().map((e) => (
                <li
                  key={e.id}
                  className="rounded-sm border border-[var(--line)] px-2 py-1.5 text-[11px] text-[var(--ink-muted)]"
                >
                  <p className="font-semibold text-[var(--ink)]">
                    {eventLogLine(e, me?.id)}
                  </p>
                  <p className="mt-0.5 font-mono text-[9px] text-[var(--ink-faint)]">
                    {new Date(e.ts).toLocaleTimeString()}
                    {e.destroyed ? ` · destroyed ${e.destroyed}` : ""}
                    {e.lootedGold > 0 ? ` · ${e.lootedGold}g loot` : ""}
                  </p>
                  <button
                    type="button"
                    className="mt-1 text-[9px] font-bold text-[var(--sand)]"
                    onClick={() => {
                      setBattleSummary(
                        summaryFromEvent(e, e.defenderId === me?.id)
                      );
                      setShowBattles(false);
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
                        · {p.gold}g · {p.soldiers}⚔ {p.tanks}🛡
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
                  <li
                    key={r.id}
                    className={`flex items-center justify-between rounded-sm border px-2.5 py-2 text-[12px] ${
                      mine
                        ? "border-[var(--sand)] bg-[var(--wash)] text-[var(--sand)]"
                        : "border-[var(--line)] text-[var(--ink-muted)]"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="font-mono text-[var(--ink-faint)]">
                        {i === 0
                          ? "🥇"
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
                      {r.farmed}
                    </span>
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
                if (inviteLink) {
                  void navigator.clipboard.writeText(inviteLink);
                  showToast("Invite link copied — friend joins, you gain +1 villager");
                }
              }}
            >
              ⎘ Copy invite link (+1 villager)
            </button>
          )}
        </div>
      )}

      {/* Persistent battle report (attacker + defender) — blocks until dismissed */}
      {battleSummary && (
        <div
          className="battle-report-overlay absolute inset-0 z-[60] flex items-start justify-center px-3 pt-16 sm:items-center sm:pt-0"
          role="dialog"
          aria-modal="true"
          aria-label="Battle report"
        >
          <div
            className={`battle-report pointer-events-auto w-[min(22rem,calc(100%-1rem))] p-4 ${
              battleSummary.role === "defender"
                ? "battle-report-defense"
                : battleSummary.win
                  ? "battle-report-win"
                  : "battle-report-loss"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/70">
                  Battle report
                </p>
                <p className="font-display text-2xl text-white">
                  {battleSummary.headline}
                </p>
              </div>
              <button
                type="button"
                className="rounded-sm border border-white/30 px-2 py-0.5 text-[10px] font-bold text-white/90"
                onClick={dismissBattle}
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-xs text-white/85">
              {battleSummary.role === "attacker" ? "vs" : "from"}{" "}
              <span className="font-semibold">{battleSummary.opponent}</span>
              {" · "}
              {battleSummary.sectorName}
            </p>
            <ul className="mt-3 space-y-1 border-t border-white/20 pt-3 text-xs text-white/90">
              {battleSummary.rows.map((row) => (
                <li key={row}>· {row}</li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-4 w-full rounded-sm bg-white/20 px-3 py-2 text-sm font-bold text-white"
              onClick={dismissBattle}
            >
              Close report
            </button>
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

      {/* ---- Attack panel: only after tapping an enemy house ---- */}
      {enemySelected && enemyPlayer && !placing && !needsHouseRebuild && (
        <div
          className={`absolute left-1/2 z-20 w-[calc(100%-1.5rem)] max-w-xs -translate-x-1/2 sm:bottom-8 ${
            buildOpen ? "bottom-56" : "bottom-28"
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
            <p className="mt-2 font-mono text-[10px] text-[var(--sand)]">
              Your attack {myAttack}
              <span className="text-[var(--ink-faint)]">
                {" "}
                ({attackBreakdown(me?.soldiers ?? 0, me?.tanks ?? 0)})
              </span>
            </p>
            <p className="font-mono text-[10px] text-[var(--ink-muted)]">
              Their defense {enemyDefense}
              <span className="text-[var(--ink-faint)]">
                {" "}
                ({defenseBreakdown(enemyPlayer)})
              </span>
            </p>
            <p className="mt-1 text-[9px] text-[var(--ink-faint)]">
              Soldier = 1 atk · Tank = 3 atk · House/soldier = 1 def · Tank/turret
              = 2 def
            </p>
            <button
              type="button"
              disabled={
                busy ||
                !me ||
                !me.house ||
                me.soldiers + me.tanks <= 0 ||
                Boolean(march)
              }
              onClick={() => void launchAttack()}
              className="mt-2 w-full rounded-sm bg-[var(--signal)] px-3 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              ⚔ Attack {enemyPlayer.name} ({myAttack} vs {enemyDefense})
            </button>
            <button
              type="button"
              className="mt-1.5 text-[9px] font-mono text-[var(--ink-faint)] underline decoration-dotted"
              onClick={() => setSelectedPlayerId(null)}
            >
              Cancel target
            </button>
            {me && me.soldiers + me.tanks <= 0 && (
              <p className="mt-1 text-[9px] text-[var(--ink-faint)]">
                Recruit soldiers or build a tank from the army panel first
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---- Bottom dock: army row + collapsible build (no overlap on mobile) ---- */}
      {claimed && me && (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex flex-col items-stretch gap-2 sm:inset-x-3 sm:bottom-3 sm:flex-row sm:items-end sm:justify-between">
          {/* Build tray — above army on mobile when open; always visible on sm+ */}
          <div
            className={`pointer-events-auto order-1 self-end sm:order-2 sm:self-auto ${
              buildOpen ? "block" : "hidden sm:block"
            }`}
          >
            <div className="hud-panel p-1.5 sm:p-2">
              <div className="flex items-center justify-between gap-2 px-1 pb-1">
                <p className="font-mono text-[8px] uppercase tracking-[0.24em] text-[var(--ink-faint)]">
                  Build · tap then place
                </p>
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
              <div className="grid grid-cols-2 gap-1.5">
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
                      className={`cameo ${active ? "cameo-active" : ""} ${
                        affordable && !active ? "cameo-blink" : ""
                      }`}
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
                      <BuildingThumb type={b.type} className="h-9 w-10" />
                      <span className="cameo-cost">{b.cost}g</span>
                      <span className="cameo-label">{b.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="pointer-events-auto order-2 max-w-full overflow-x-auto sm:order-1">
            <div className="hud-panel inline-flex items-end gap-1.5 p-1.5 sm:gap-2 sm:p-2">
              <div className="cameo" title={`${me.villagers} villager(s) gathering`}>
                <VillagerSprite walking className="h-9 w-9" />
                <span className="cameo-badge">×{me.villagers}</span>
                <span className="cameo-label">Villager</span>
              </div>
              <div
                className="cameo"
                title={
                  me.house
                    ? `House ${me.houseHp}/${HOUSE_MAX_HP} hp · defense ${myDefense}`
                    : "House destroyed — rebuild to gather"
                }
              >
                <HouseSprite className="h-9 w-10" />
                {me.house ? (
                  <span className="cameo-badge">
                    {me.houseHp}/{HOUSE_MAX_HP}
                  </span>
                ) : (
                  <span className="cameo-badge">✕</span>
                )}
                <span className="cameo-label">House</span>
              </div>
              <button
                type="button"
                className={`cameo ${
                  displayGold >= SOLDIER_COST ? "cameo-blink" : ""
                }`}
                disabled={busy || displayGold < SOLDIER_COST || !me.house}
                title={`Recruit soldier — ${SOLDIER_COST}g · +1 attack / +1 defense`}
                onClick={() =>
                  void act("recruit_soldier").then((d) => {
                    if (d) {
                      playRecruitSound();
                      showToast("Soldier recruited · +1 attack");
                    }
                  })
                }
              >
                <SoldierSprite className="h-9 w-9" />
                {me.soldiers > 0 && (
                  <span className="cameo-badge">×{me.soldiers}</span>
                )}
                <span className="cameo-cost">{SOLDIER_COST}g</span>
                <span className="cameo-label">Soldier</span>
              </button>
              <button
                type="button"
                className={`cameo ${
                  displayGold >= TANK_COST ? "cameo-blink" : ""
                }`}
                disabled={busy || displayGold < TANK_COST || !me.house}
                title={`Build tank — ${TANK_COST}g · +3 attack / +2 defense`}
                onClick={() =>
                  void act("build_tank").then((d) => {
                    if (d) {
                      playRecruitSound();
                      showToast("Tank ready · +3 attack");
                    }
                  })
                }
              >
                <TankSprite className="h-9 w-11" />
                {me.tanks > 0 && (
                  <span className="cameo-badge">×{me.tanks}</span>
                )}
                <span className="cameo-cost">{TANK_COST}g</span>
                <span className="cameo-label">Tank</span>
              </button>
              {gemsFound > 0 && (
                <div className="cameo" title={`${gemsFound} resource site(s) found`}>
                  <ResourceGem gem="diamond" size={26} pulse />
                  <span className="cameo-badge">×{gemsFound}</span>
                  <span className="cameo-label">Finds</span>
                </div>
              )}
              {/* Mobile build toggle — avoids stacking the full grid over army */}
              <button
                type="button"
                className={`cameo sm:hidden ${buildOpen ? "cameo-active" : ""}`}
                title="Open build menu"
                onClick={() => setBuildOpen((o) => !o)}
              >
                <MillSprite className="h-8 w-9" />
                <span className="cameo-label">{buildOpen ? "Close" : "Build"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
