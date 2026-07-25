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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [displayGold, setDisplayGold] = useState(0);
  const [showMissions, setShowMissions] = useState(false);
  const [showRanks, setShowRanks] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  const [showBattles, setShowBattles] = useState(false);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [pendingHouse, setPendingHouse] = useState<LatLng | null>(null);
  const [march, setMarch] = useState<MarchAnim | null>(null);
  const [impact, setImpact] = useState<ImpactAnim | null>(null);
  const [battleSummary, setBattleSummary] = useState<BattleSummary | null>(
    null
  );
  /** Live GPS pin shown on the map while picking a sector */
  const [liveLocation, setLiveLocation] = useState<LatLng | null>(null);
  /** GPS fix confirmed inside the sector being claimed */
  const [gpsFix, setGpsFix] = useState<{
    sectorId: string;
    lat: number;
    lng: number;
  } | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [locationFocus, setLocationFocus] = useState(0);
  const gpsWatchStarted = useRef(false);
  const identityChecked = useRef(false);
  const seenEvents = useRef<Set<string>>(new Set());
  const eventsPrimed = useRef(false);
  const meIdRef = useRef<string | null>(null);

  const IDENT_KEY = "itw_player_id";

  const applySnap = useCallback((data: GameSnapshot) => {
    setSnap(data);
    if (data.me) setDisplayGold(data.me.gold);
    setSelectedId(
      (cur) => cur ?? data.me?.homeSectorId ?? data.sectors[0]?.id ?? null
    );

    const nextId = data.me?.id ?? null;
    if (nextId !== meIdRef.current) {
      // New identity (first load or player switch) — don't replay history
      meIdRef.current = nextId;
      seenEvents.current = new Set();
      eventsPrimed.current = false;
    }

    const events = data.events ?? [];
    if (!eventsPrimed.current) {
      for (const e of events) seenEvents.current.add(e.id);
      eventsPrimed.current = true;
      // Unacknowledged hits on this account — stay until dismissed
      const ack = typeof window !== "undefined" ? readBattleAck() : 0;
      const pendingHit = [...events]
        .reverse()
        .find(
          (e) => data.me && e.defenderId === data.me.id && e.ts > ack
        );
      if (pendingHit) {
        setBattleSummary(summaryFromEvent(pendingHit));
      }
      return;
    }
    for (const e of events) {
      if (seenEvents.current.has(e.id)) continue;
      seenEvents.current.add(e.id);
      if (data.me && e.defenderId === data.me.id) {
        const summary = summaryFromEvent(e);
        if (data.me.house) {
          setImpact({ at: data.me.house, startedAt: Date.now() });
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
    const id = window.setInterval(() => void load(), 4000);
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
  const enemyPlayer = selected
    ? snap?.players.find((p) => p.homeSectorId === selected.id)
    : null;
  const enemyDefense = enemyPlayer
    ? defensePower({
        soldiers: enemyPlayer.soldiers,
        tanks: enemyPlayer.tanks,
        buildings: enemyPlayer.buildings,
        house: enemyPlayer.house,
        houseHp: enemyPlayer.houseHp,
      })
    : 0;

  const sectorOwner = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const p of snap?.players ?? []) {
      if (p.homeSectorId) {
        map.set(p.homeSectorId, { id: p.id, name: p.name });
      }
    }
    return map;
  }, [snap]);

  const gemsFound = useMemo(() => {
    if (!me) return 0;
    return me.discoveredSpotIds.filter((id) =>
      snap?.spots.some((s) => s.id === id && s.kind === "hidden")
    ).length;
  }, [me, snap]);

  const ranking = useMemo(() => {
    const rows = (snap?.players ?? [])
      .filter((p) => p.homeSectorId)
      .map((p) => ({
        id: p.id,
        name: p.name,
        sector:
          snap?.sectors.find((s) => s.id === p.homeSectorId)?.name ?? "—",
        farmed: p.totalFarmed,
      }))
      .sort((a, b) => b.farmed - a.farmed);
    return rows.slice(0, 10);
  }, [snap]);

  const missionList = useMemo(() => {
    if (!me) return [];
    return [
      {
        id: "claim",
        label: "Claim one sector forever",
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

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
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
      applySnap(data as GameSnapshot);
      return data;
    } catch {
      setError("Network error");
      window.setTimeout(() => setError(null), 3200);
      return null;
    } finally {
      setBusy(false);
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

  const confirmGpsForSector = (sectorId: string, _sectorName: string) => {
    requestGps(sectorId);
  };

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
        const data = await act("place_house", {
          lat: pendingHouse.lat,
          lng: pendingHouse.lng,
          villagerLat: lat,
          villagerLng: lng,
        });
        if (data) {
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

      const data = await act("claim_sector", {
        sectorId: placing.sector.id,
        lat: pendingHouse.lat,
        lng: pendingHouse.lng,
        villagerLat: lat,
        villagerLng: lng,
        gpsLat: gpsFix.lat,
        gpsLng: gpsFix.lng,
      });
      if (data) {
        showToast(`${placing.sector.name} claimed — your village is live!`);
        setPlacing(null);
        setPendingHouse(null);
        setGpsFix(null);
      }
      // On error stay in villager placement so they can adjust
      return;
    }

    // Building placement
    const data = await act("build", {
      buildingType: placing.kind,
      lat,
      lng,
    });
    if (data) {
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
    if (!me?.house || !selected) return;
    const targetSector = selected;
    const defenderName =
      snap?.players.find((p) => p.homeSectorId === targetSector.id)?.name ??
      "enemy";
    const target =
      snap?.players.find((p) => p.homeSectorId === targetSector.id)?.house ??
      ringCentroid(targetSector.ring);
    const durationMs = 3200;
    const marchStarted = Date.now();
    setMarch({
      from: me.house,
      to: target,
      startedAt: marchStarted,
      durationMs,
    });
    const data = await act("attack", { sectorId: targetSector.id });
    const battle = data?.battle as BattleReport | undefined;

    if (!data || !battle) {
      setMarch(null);
      return;
    }

    const summary = summaryFromAttack(
      battle,
      targetSector.name,
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

  const enemySelected =
    claimed &&
    selected &&
    selected.id !== me?.homeSectorId &&
    sectorOwner.has(selected.id);

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
      {/* Full-bleed map */}
      <div className="absolute inset-0">
        <GameMap
          sectors={snap?.sectors ?? []}
          spots={snap?.spots ?? []}
          me={me}
          players={snap?.players ?? []}
          selectedId={selectedId}
          placing={placing}
          previewHouse={pendingHouse}
          userLocation={!claimed ? liveLocation : null}
          userLocationFocus={locationFocus}
          march={march}
          impact={impact}
          onSelect={setSelectedId}
          onPlace={(lat, lng) => void handlePlace(lat, lng)}
          onSpawnFind={(p) => spawnFind(p)}
          onCollectHidden={(spotId) => void act("collect_hidden", { spotId }).then((d) => {
            if (d?.gained) showToast(`Collected +${d.gained} gold`);
          })}
          className="h-full w-full"
        />
      </div>

      {/* ---- Top bar ---- */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-start justify-between gap-2 p-2 sm:p-3">
        <div className="pointer-events-auto hud-chip px-3 py-1.5">
          <Link href="/" className="font-display text-xs text-[var(--ink)] sm:text-sm">
            Islamabad Territorial Wars
          </Link>
          <p className="font-mono text-[8px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
            {claimed ? `Home · ${homeName}` : "Pick your sector"}
          </p>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <div className="hud-chip px-3 py-1.5">
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
            onClick={() => {
              setShowBattles((v) => !v);
              setShowRanks(false);
              setShowMissions(false);
              setShowPlayers(false);
            }}
            className="hud-chip px-3 py-1.5 font-mono text-[10px] text-[var(--ink-muted)] hover:text-[var(--sand)]"
            title="Recent battle reports"
          >
            ⚔ {(snap?.events ?? []).length}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowRanks((v) => !v);
              setShowMissions(false);
              setShowPlayers(false);
              setShowBattles(false);
            }}
            className="hud-chip px-3 py-1.5 font-mono text-[10px] text-[var(--ink-muted)] hover:text-[var(--sand)]"
          >
            🏆 Ranks
          </button>
          <button
            type="button"
            onClick={() => {
              setShowMissions((v) => !v);
              setShowRanks(false);
              setShowPlayers(false);
              setShowBattles(false);
            }}
            className="hud-chip px-3 py-1.5 font-mono text-[10px] text-[var(--ink-muted)] hover:text-[var(--sand)]"
          >
            ◈ {missionsDone}/{missionList.length}
          </button>
          {snap?.authDisabled ? (
            <button
              type="button"
              onClick={() => {
                setShowPlayers((v) => !v);
                setShowRanks(false);
                setShowMissions(false);
                setShowBattles(false);
              }}
              className="hud-chip px-3 py-1.5 font-mono text-[10px] text-[var(--ink-muted)] hover:text-[var(--sand)]"
              title="Switch player (testing)"
            >
              👤 {me?.name?.replace("Settler ", "") ?? "…"}
            </button>
          ) : me ? (
            <div className="hud-chip flex items-center gap-2 px-3 py-1.5">
              <span className="max-w-[7rem] truncate font-mono text-[10px] text-[var(--sand)]">
                {me.name}
              </span>
              <button
                type="button"
                className="font-mono text-[9px] text-[var(--ink-muted)] hover:text-[var(--signal-bright)]"
                onClick={() => void signOut({ callbackUrl: "/play" })}
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="hud-chip px-3 py-1.5 font-mono text-[10px] text-[var(--sand)]"
            >
              Sign in
            </Link>
          )}
          <Link
            href="/edit"
            className="hud-chip hidden px-3 py-1.5 font-mono text-[10px] text-[var(--ink-muted)] hover:text-[var(--sand)] sm:block"
          >
            Map editor
          </Link>
        </div>
      </div>

      {/* Recent battles log */}
      {showBattles && (
        <div className="absolute right-2 top-14 z-30 w-80 max-w-[calc(100%-1rem)] hud-panel p-3 sm:right-3">
          <h2 className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            Recent battles
          </h2>
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
        <div className="absolute right-2 top-14 z-30 w-72 hud-panel p-3 sm:right-3">
          <h2 className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            Switch player · test accounts
          </h2>
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

      {/* Ranks dropdown */}
      {showRanks && (
        <div className="absolute right-2 top-14 z-30 w-72 hud-panel p-3 sm:right-3">
          <h2 className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            Global sector ranking · resources farmed
          </h2>
          <ol className="mt-2 space-y-1">
            {ranking.length === 0 && (
              <li className="text-[11px] text-[var(--ink-faint)]">
                No sectors claimed yet
              </li>
            )}
            {ranking.map((r, i) => (
              <li
                key={r.id}
                className={`flex items-center justify-between text-[11px] ${
                  r.id === me?.id
                    ? "text-[var(--sand)]"
                    : "text-[var(--ink-muted)]"
                }`}
              >
                <span>
                  <span className="font-mono">
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
                  </span>{" "}
                  <strong>{r.sector}</strong>{" "}
                  <span className="text-[var(--ink-faint)]">· {r.name}</span>
                </span>
                <span className="font-mono">{r.farmed}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Missions dropdown */}
      {showMissions && (
        <div className="absolute right-2 top-14 z-30 w-64 hud-panel p-3 sm:right-3">
          <h2 className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            Missions
          </h2>
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

      {/* Toast / error */}
      {(toast || error) && !battleSummary && (
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
      {placing && (
        <div className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 sm:bottom-8">
          <button
            type="button"
            onClick={cancelPlacement}
            className="hud-chip px-4 py-2 text-xs font-semibold text-[var(--signal-bright)]"
          >
            ✕ Cancel placement
          </button>
        </div>
      )}

      {/* ---- Claim prompt (unclaimed) ---- */}
      {!claimed && selected && !placing && (
        <div className="absolute bottom-24 left-1/2 z-20 w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 sm:bottom-8">
          <div className="hud-panel p-4 text-center">
            <p className="font-display text-2xl text-[var(--ink)]">
              {selected.name}
            </p>
            <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
              {sectorOwner.has(selected.id)
                ? `Claimed by ${sectorOwner.get(selected.id)!.name}`
                : "Open territory — your blue pin is your GPS. Confirm you're inside, then place your house."}
            </p>
            {!sectorOwner.has(selected.id) && liveLocation && (
              <p className="mt-1 font-mono text-[9px] text-[#9fd0ff]">
                {pointInOrNearRing(liveLocation, selected.ring, 120)
                  ? `Blue pin is inside ${selected.name}`
                  : `Blue pin is outside ${selected.name} — move closer`}
              </p>
            )}
            {!sectorOwner.has(selected.id) && (
              <>
                <button
                  type="button"
                  disabled={busy || !me || gpsBusy}
                  onClick={() =>
                    confirmGpsForSector(selected.id, selected.name)
                  }
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
                        ? "📍 Confirm this pin for claim"
                        : "📍 Show my location"}
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    !me ||
                    gpsFix?.sectorId !== selected.id
                  }
                  onClick={() => {
                    setPendingHouse(null);
                    setPlacing({ kind: "house", sector: selected });
                    showToast("Tap the map to place your house");
                  }}
                  className="mt-2 w-full rounded-sm bg-[var(--signal)] px-3 py-2.5 text-sm font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.5)] disabled:opacity-40"
                >
                  ⚑ Claim {selected.name} — place your house
                </button>
              </>
            )}
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {(snap?.sectors ?? []).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(s.id);
                    if (gpsFix && gpsFix.sectorId !== s.id) setGpsFix(null);
                  }}
                  className={`rounded-sm border px-2 py-1 font-mono text-[9px] ${
                    s.id === selectedId
                      ? "border-[var(--sand)] text-[var(--sand)]"
                      : "border-[var(--line)] text-[var(--ink-muted)]"
                  }`}
                >
                  {s.name}
                  {sectorOwner.has(s.id) ? " ●" : ""}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ---- Rebuild house after it was destroyed ---- */}
      {needsHouseRebuild && me?.homeSectorId && !placing && (
        <div className="absolute bottom-24 left-1/2 z-20 w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 sm:bottom-8">
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

      {/* ---- Attack panel: enemy sector selected ---- */}
      {enemySelected && !placing && !needsHouseRebuild && (
        <div className="absolute bottom-24 left-1/2 z-20 w-[calc(100%-1.5rem)] max-w-xs -translate-x-1/2 sm:bottom-8">
          <div className="hud-panel p-3 text-center">
            <p className="font-display text-lg text-[var(--ink)]">
              {selected!.name}
            </p>
            <p className="text-[10px] text-[var(--ink-muted)]">
              Held by {sectorOwner.get(selected!.id)!.name}
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
              {enemyPlayer && (
                <span className="text-[var(--ink-faint)]">
                  {" "}
                  ({defenseBreakdown(enemyPlayer)})
                </span>
              )}
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
              ⚔ Attack ({myAttack} vs {enemyDefense})
            </button>
            {me && me.soldiers + me.tanks <= 0 && (
              <p className="mt-1 text-[9px] text-[var(--ink-faint)]">
                Recruit soldiers or build a tank from the army panel first
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---- Bottom-left: village + army cameos ---- */}
      {claimed && me && (
        <div className="absolute bottom-2 left-2 z-20 sm:bottom-3 sm:left-3">
          <div className="hud-panel flex items-end gap-1.5 p-1.5 sm:gap-2 sm:p-2">
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
                  if (d) showToast("Soldier recruited · +1 attack");
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
                  if (d) showToast("Tank ready · +3 attack");
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
          </div>
        </div>
      )}

      {/* ---- Bottom-right: build sidebar ---- */}
      {claimed && me && (
        <div className="absolute bottom-2 right-2 z-20 sm:bottom-3 sm:right-3">
          <div className="hud-panel p-1.5 sm:p-2">
            <p className="px-1 pb-1 text-center font-mono text-[8px] uppercase tracking-[0.24em] text-[var(--ink-faint)]">
              Build · tap then place
            </p>
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
      )}
    </main>
  );
}
