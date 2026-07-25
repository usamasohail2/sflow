import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { BuildingType } from "@/lib/gameTypes";
import { AUTH_DISABLED } from "@/lib/devMode";
import {
  attackSector,
  buildBuilding,
  buildTank,
  claimSector,
  collectHidden,
  discoverSpot,
  ensurePlayer,
  getSnapshot,
  recruitSoldier,
  renamePlayer,
  spawnRoamFind,
} from "@/lib/store";

export const dynamic = "force-dynamic";

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
  identity: Identity;
  setCookie?: string;
}> {
  if (!AUTH_DISABLED) {
    return {
      identity: {
        id: "needs-auth",
        email: "",
        name: "Guest",
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
    bearing?: number;
    zoom?: number;
    roamMeters?: number;
    exploreMs?: number;
  };

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
    result = await claimSector(id, body.sectorId);
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
  } else if (body.action === "recruit_soldier") {
    result = await recruitSoldier(id);
  } else if (body.action === "build_tank") {
    result = await buildTank(id);
  } else if (body.action === "attack") {
    if (!body.sectorId) {
      return withGuestCookie(
        NextResponse.json({ error: "Pick a target sector" }, { status: 400 }),
        setCookie
      );
    }
    result = await attackSector(id, body.sectorId);
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
