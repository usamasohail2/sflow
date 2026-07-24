import { NextResponse } from "next/server";
// import { auth } from "@/auth";
import { pointInRing } from "@/lib/geo";
import type { Player } from "@/lib/gameTypes";
import { AUTH_DISABLED, GUEST_PLAYER_ID } from "@/lib/devMode";
import {
  getInviteOwner,
  loadAccruedState,
  makeInviteCode,
  saveEconomies,
  savePlayers,
  setInviteCode,
} from "@/lib/store";

export const dynamic = "force-dynamic";

type Identity = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
};

async function resolveIdentity(/* session */): Promise<Identity | null> {
  // Google sign-in temporarily commented out
  // const session = await auth();
  // if (session?.user) {
  //   const id = session.user.id?.trim() || session.user.email?.trim();
  //   if (id) {
  //     return {
  //       id,
  //       email: session.user.email || "",
  //       name: session.user.name || "Explorer",
  //       image: session.user.image,
  //     };
  //   }
  // }

  if (AUTH_DISABLED) {
    return {
      id: GUEST_PLAYER_ID,
      email: "guest@local.dev",
      name: "Guest Dev",
      image: null,
    };
  }
  return null;
}

async function ensurePlayer(
  identity: Identity,
  inviteCodeFromClient?: string | null
): Promise<Player> {
  const { players, economies } = await loadAccruedState();
  let me = players[identity.id];
  const now = Date.now();

  if (!me) {
    let inviteCode = makeInviteCode(identity.email || identity.id);
    while (await getInviteOwner(inviteCode)) {
      inviteCode = makeInviteCode(identity.id + Math.random());
    }
    await setInviteCode(inviteCode, identity.id);

    let invitedBy: string | null = null;
    const villagers = 1;
    const houseSlots = 1;

    const ref = inviteCodeFromClient?.trim().toUpperCase();
    if (ref) {
      const ownerId = await getInviteOwner(ref);
      if (ownerId && ownerId !== identity.id && players[ownerId]) {
        invitedBy = ownerId;
        const inviter = players[ownerId]!;
        players[ownerId] = {
          ...inviter,
          villagers: inviter.villagers + 1,
          houseSlots: inviter.houseSlots + 1,
          updatedAt: now,
        };
      }
    }

    me = {
      id: identity.id,
      email: identity.email,
      name: identity.name,
      image: identity.image,
      inviteCode,
      invitedBy,
      villagers,
      houseSlots,
      housesPlaced: 0,
      activeSectorId: null,
      createdAt: now,
      updatedAt: now,
    };
    players[identity.id] = me;
    await savePlayers(players);
    await saveEconomies(economies);
  }

  return players[identity.id] ?? me;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const invite = url.searchParams.get("invite");
  const identity = await resolveIdentity();

  if (identity) {
    await ensurePlayer(identity, invite);
  }

  const { sectors, players, economies, serverNow } = await loadAccruedState();
  const me = identity ? players[identity.id] ?? null : null;

  return NextResponse.json({
    sectors,
    players: Object.values(players).map((p) => ({
      id: p.id,
      name: p.name,
      image: p.image,
      villagers: p.villagers,
      housesPlaced: p.housesPlaced,
      houseSlots: p.houseSlots,
      activeSectorId: p.activeSectorId,
    })),
    economies,
    me,
    serverNow,
    authDisabled: AUTH_DISABLED,
  });
}

export async function POST(req: Request) {
  const identity = await resolveIdentity();
  if (!identity) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const body = (await req.json()) as {
    action?: string;
    sectorId?: string;
    lat?: number;
    lng?: number;
    invite?: string;
  };

  await ensurePlayer(identity, body.invite);
  const { sectors, players, economies, serverNow } = await loadAccruedState();
  const id = identity.id;
  const me = players[id];
  if (!me) {
    return NextResponse.json({ error: "Player missing" }, { status: 500 });
  }

  const now = Date.now();

  if (body.action === "join_sector") {
    const sector = sectors.find((s) => s.id === body.sectorId);
    if (!sector) {
      return NextResponse.json({ error: "Unknown sector" }, { status: 404 });
    }
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json(
        { error: "Location required to join a sector" },
        { status: 400 }
      );
    }
    if (!pointInRing({ lat, lng }, sector.ring)) {
      return NextResponse.json(
        {
          error:
            "You must be inside this sector (use GPS or drop your pin on the map) to station your villagers here.",
        },
        { status: 400 }
      );
    }

    players[id] = {
      ...me,
      activeSectorId: sector.id,
      updatedAt: now,
    };
    await savePlayers(players);

    if (!economies[sector.id]) {
      economies[sector.id] = {
        sectorId: sector.id,
        resources: 0,
        lastTickAt: now,
      };
      await saveEconomies(economies);
    }
  } else if (body.action === "place_house") {
    if (!me.activeSectorId) {
      return NextResponse.json(
        { error: "Join a sector before placing a house" },
        { status: 400 }
      );
    }
    if (me.housesPlaced >= me.houseSlots) {
      return NextResponse.json(
        { error: "No house slots left — invite a friend to unlock another" },
        { status: 400 }
      );
    }
    players[id] = {
      ...me,
      housesPlaced: me.housesPlaced + 1,
      updatedAt: now,
    };
    await savePlayers(players);
  } else if (body.action === "leave_sector") {
    players[id] = {
      ...me,
      activeSectorId: null,
      updatedAt: now,
    };
    await savePlayers(players);
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const refreshed = await loadAccruedState();
  return NextResponse.json({
    ok: true,
    me: refreshed.players[id],
    economies: refreshed.economies,
    players: Object.values(refreshed.players).map((p) => ({
      id: p.id,
      name: p.name,
      villagers: p.villagers,
      housesPlaced: p.housesPlaced,
      houseSlots: p.houseSlots,
      activeSectorId: p.activeSectorId,
    })),
    serverNow: refreshed.serverNow || serverNow,
  });
}
