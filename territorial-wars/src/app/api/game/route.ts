import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pointInRing } from "@/lib/geo";
import type { Player } from "@/lib/gameTypes";
import {
  getInviteOwner,
  loadAccruedState,
  makeInviteCode,
  saveEconomies,
  savePlayers,
  setInviteCode,
} from "@/lib/store";

export const dynamic = "force-dynamic";

function playerIdFromSession(session: {
  user?: { id?: string; email?: string | null };
}): string | null {
  const id = session.user?.id?.trim();
  if (id) return id;
  const email = session.user?.email?.trim();
  return email || null;
}

async function ensurePlayer(
  session: {
    user?: {
      id?: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
    };
  },
  inviteCodeFromClient?: string | null
): Promise<Player | null> {
  const id = playerIdFromSession(session);
  if (!id) return null;

  const { players, economies } = await loadAccruedState();
  let me = players[id];
  const now = Date.now();

  if (!me) {
    let inviteCode = makeInviteCode(session.user?.email || id);
    // rare collision
    while (await getInviteOwner(inviteCode)) {
      inviteCode = makeInviteCode(id + Math.random());
    }
    await setInviteCode(inviteCode, id);

    let invitedBy: string | null = null;
    const villagers = 1;
    const houseSlots = 1;

    const ref = inviteCodeFromClient?.trim().toUpperCase();
    if (ref) {
      const ownerId = await getInviteOwner(ref);
      if (ownerId && ownerId !== id && players[ownerId]) {
        invitedBy = ownerId;
        // Inviter gains +1 villager and +1 house slot
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
      id,
      email: session.user?.email || "",
      name: session.user?.name || "Explorer",
      image: session.user?.image,
      inviteCode,
      invitedBy,
      villagers,
      houseSlots,
      housesPlaced: 0,
      activeSectorId: null,
      createdAt: now,
      updatedAt: now,
    };
    players[id] = me;
    await savePlayers(players);
    await saveEconomies(economies);
  }

  return players[id] ?? me;
}

export async function GET(req: Request) {
  const session = await auth();
  const url = new URL(req.url);
  const invite = url.searchParams.get("invite");

  if (session?.user) {
    await ensurePlayer(session, invite);
  }

  const { sectors, players, economies, serverNow } = await loadAccruedState();
  const id = session?.user ? playerIdFromSession(session) : null;
  const me = id ? players[id] ?? null : null;

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
    authConfigured: Boolean(
      process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
    ),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in with Google first" }, { status: 401 });
  }

  const body = (await req.json()) as {
    action?: string;
    sectorId?: string;
    lat?: number;
    lng?: number;
    invite?: string;
  };

  await ensurePlayer(session, body.invite);
  const { sectors, players, economies, serverNow } = await loadAccruedState();
  const id = playerIdFromSession(session)!;
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

    // Leaving previous sector is automatic — only one sector
    players[id] = {
      ...me,
      activeSectorId: sector.id,
      updatedAt: now,
    };
    await savePlayers(players);

    // Ensure economy row exists
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
