import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { BuildingType } from "@/lib/gameTypes";
import { AUTH_DISABLED } from "@/lib/devMode";
import {
  attackSector,
  buildBuilding,
  buyRocket,
  claimSector,
  collectHidden,
  discoverSpot,
  ensurePlayer,
  getSnapshot,
  placeHouse,
  renamePlayer,
  spawnRoamFind,
} from "@/lib/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const GUEST_COOKIE = "itw_guest_id";

type Identity = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
};

function newGuestId(): string {
  return `guest_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

async function resolveIdentity(): Promise<{
  identity: Identity | null;
  setCookie?: string;
}> {
  if (!AUTH_DISABLED) {
    const session = await auth();
    const user = session?.user;
    const uid = (user as { id?: string } | undefined)?.id?.trim();
    if (!user || !uid) {
      return { identity: null };
    }
    return {
      identity: {
        id: uid.startsWith("google_") ? uid : `google_${uid}`,
        email: user.email || `${uid}@google.local`,
        name: user.name?.trim() || "Commander",
        image: user.image,
      },
    };
  }

  const jar = await cookies();
  let id = jar.get(GUEST_COOKIE)?.value;
  let setCookie: string | undefined;
  if (!id || !id.startsWith("guest_")) {
    id = newGuestId();
    setCookie = id;
  }

  const short = id.slice(-4).toUpperCase();
  return {
    identity: {
      id,
      email: `${id}@guest.local`,
      name: `Settler ${short}`,
    },
    setCookie,
  };
}

function withGuestCookie(res: NextResponse, guestId?: string) {
  if (guestId) {
    res.cookies.set(GUEST_COOKIE, guestId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const invite = url.searchParams.get("invite");
  const { identity, setCookie } = await resolveIdentity();

  if (!identity) {
    const snap = await getSnapshot(null);
    return NextResponse.json(snap);
  }

  await ensurePlayer(
    identity.id,
    identity.name,
    identity.email,
    identity.image,
    invite
  );
  const snap = await getSnapshot(identity.id);
  return withGuestCookie(NextResponse.json(snap), setCookie);
}

export async function POST(req: Request) {
  const { identity, setCookie } = await resolveIdentity();
  const body = (await req.json()) as {
    action?: string;
    sectorId?: string;
    spotId?: string;
    buildingType?: BuildingType;
    invite?: string;
    name?: string;
    lat?: number;
    lng?: number;
    villagerLat?: number;
    villagerLng?: number;
    gpsLat?: number;
    gpsLng?: number;
    bearing?: number;
    zoom?: number;
    roamMeters?: number;
    exploreMs?: number;
    targetId?: string;
    targetPlayerId?: string;
    /** Rockets to fire in an attack salvo */
    rockets?: number;
  };

  // Dev/test helper: hop between guest accounts (auth is disabled)
  if (body.action === "switch_player") {
    if (!AUTH_DISABLED) {
      return NextResponse.json(
        { error: "Player switching only works in guest mode" },
        { status: 403 }
      );
    }
    const target =
      typeof body.targetId === "string" && body.targetId.startsWith("guest_")
        ? body.targetId
        : newGuestId();
    const short = target.slice(-4).toUpperCase();
    await ensurePlayer(
      target,
      `Settler ${short}`,
      `${target}@guest.local`,
      null
    );
    const snap = await getSnapshot(target);
    return withGuestCookie(NextResponse.json({ ok: true, ...snap }), target);
  }

  if (!identity) {
    return NextResponse.json(
      { error: "Sign in with Google to play" },
      { status: 401 }
    );
  }

  await ensurePlayer(
    identity.id,
    identity.name,
    identity.email,
    identity.image,
    body.invite
  );

  const id = identity.id;
  let result: {
    ok?: true;
    error?: string;
    bonus?: number;
    gained?: number;
    gem?: string;
    spotId?: string;
    battle?: unknown;
  };

  if (body.action === "claim_sector") {
    if (!body.sectorId) {
      return withGuestCookie(
        NextResponse.json({ error: "Pick a sector" }, { status: 400 }),
        setCookie
      );
    }
    const housePos =
      Number.isFinite(body.lat) && Number.isFinite(body.lng)
        ? { lat: Number(body.lat), lng: Number(body.lng) }
        : undefined;
    const villagerPos =
      Number.isFinite(body.villagerLat) && Number.isFinite(body.villagerLng)
        ? { lat: Number(body.villagerLat), lng: Number(body.villagerLng) }
        : undefined;
    const gpsPos =
      Number.isFinite(body.gpsLat) && Number.isFinite(body.gpsLng)
        ? { lat: Number(body.gpsLat), lng: Number(body.gpsLng) }
        : undefined;
    result = await claimSector(
      id,
      body.sectorId,
      housePos,
      villagerPos,
      gpsPos
    );
  } else if (body.action === "place_house") {
    if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
      return withGuestCookie(
        NextResponse.json({ error: "Pick a house spot" }, { status: 400 }),
        setCookie
      );
    }
    const villagerPos =
      Number.isFinite(body.villagerLat) && Number.isFinite(body.villagerLng)
        ? { lat: Number(body.villagerLat), lng: Number(body.villagerLng) }
        : undefined;
    result = await placeHouse(
      id,
      { lat: Number(body.lat), lng: Number(body.lng) },
      villagerPos
    );
  } else if (body.action === "spawn_find") {
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const bearing = Number(body.bearing ?? 0);
    const zoom = Number(body.zoom ?? 0);
    const roamMeters = Number(body.roamMeters ?? 0);
    const exploreMs = Number(body.exploreMs ?? 0);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return withGuestCookie(
        NextResponse.json({ error: "Bad location" }, { status: 400 }),
        setCookie
      );
    }
    result = await spawnRoamFind(id, {
      lat,
      lng,
      bearing,
      zoom,
      roamMeters,
      exploreMs,
    });
  } else if (body.action === "discover_spot") {
    if (!body.spotId) {
      return withGuestCookie(
        NextResponse.json({ error: "Missing spot" }, { status: 400 }),
        setCookie
      );
    }
    result = await discoverSpot(id, body.spotId);
  } else if (body.action === "collect_hidden") {
    if (!body.spotId) {
      return withGuestCookie(
        NextResponse.json({ error: "Missing spot" }, { status: 400 }),
        setCookie
      );
    }
    result = await collectHidden(id, body.spotId);
  } else if (body.action === "build") {
    if (!body.buildingType) {
      return withGuestCookie(
        NextResponse.json({ error: "Pick a building" }, { status: 400 }),
        setCookie
      );
    }
    result = await buildBuilding(
      id,
      body.buildingType,
      Number(body.lat),
      Number(body.lng)
    );
  } else if (
    body.action === "buy_rocket" ||
    body.action === "recruit_soldier" ||
    body.action === "build_tank"
  ) {
    // Legacy soldier/tank actions map to buying a rocket
    result = await buyRocket(id);
  } else if (body.action === "attack") {
    const targetPlayerId =
      typeof body.targetPlayerId === "string"
        ? body.targetPlayerId
        : typeof body.targetId === "string"
          ? body.targetId
          : "";
    if (!targetPlayerId) {
      return withGuestCookie(
        NextResponse.json({ error: "Pick a settler to attack" }, { status: 400 }),
        setCookie
      );
    }
    const rocketsToFire =
      body.rockets != null ? Number(body.rockets) : undefined;
    result = await attackSector(id, targetPlayerId, rocketsToFire);
  } else if (body.action === "rename") {
    result = await renamePlayer(id, String(body.name || ""));
  } else {
    return withGuestCookie(
      NextResponse.json({ error: "Unknown action" }, { status: 400 }),
      setCookie
    );
  }

  if ("error" in result && result.error) {
    return withGuestCookie(
      NextResponse.json({ error: result.error }, { status: 400 }),
      setCookie
    );
  }

  const snap = await getSnapshot(id);
  return withGuestCookie(
    NextResponse.json({
      ok: true,
      ...snap,
      bonus: "bonus" in result ? result.bonus : undefined,
      gained: "gained" in result ? result.gained : undefined,
      gem: "gem" in result ? result.gem : undefined,
      spotId: "spotId" in result ? result.spotId : undefined,
      battle: "battle" in result ? result.battle : undefined,
    }),
    setCookie
  );
}
