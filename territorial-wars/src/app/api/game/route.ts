import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { pointInRing } from "@/lib/geo";
import type { Player } from "@/lib/gameTypes";
import { COSTS, STARTING } from "@/lib/gameTypes";
import { AUTH_DISABLED } from "@/lib/devMode";
import { maxVillagersAllowed } from "@/lib/rules";
import {
  getInviteOwner,
  loadAccruedState,
  makeInviteCode,
  saveEconomies,
  savePlayers,
  setInviteCode,
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

async function ensurePlayer(
  identity: Identity,
  inviteCodeFromClient?: string | null
): Promise<Player> {
  const { players, economies } = await loadAccruedState();
  let me = players[identity.id];
  const now = Date.now();

  if (!me) {
    let inviteCode = makeInviteCode(identity.name || identity.id);
    while (await getInviteOwner(inviteCode)) {
      inviteCode = makeInviteCode(identity.id + Math.random());
    }
    await setInviteCode(inviteCode, identity.id);

    let invitedBy: string | null = null;
    const villagers = STARTING.villagers;
    const houseSlots = STARTING.houseSlots;
    let gold = STARTING.gold;

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
          gold: inviter.gold + 15,
          updatedAt: now,
        };
        // Welcome gift for joining via invite
        gold += 15;
      }
    }

    me = {
      id: identity.id,
      email: identity.email,
      name: identity.name,
      image: identity.image,
      inviteCode,
      invitedBy,
      gold,
      villagers,
      houseSlots,
      housesPlaced: STARTING.housesPlaced,
      activeSectorId: null,
      digBonus: STARTING.digBonus,
      createdAt: now,
      updatedAt: now,
    };
    players[identity.id] = me;
    await savePlayers(players);
    await saveEconomies(economies);
  }

  return (await loadAccruedState()).players[identity.id]!;
}

function publicPlayer(p: Player) {
  return {
    id: p.id,
    name: p.name,
    villagers: p.villagers,
    housesPlaced: p.housesPlaced,
    houseSlots: p.houseSlots,
    gold: p.gold,
    digBonus: p.digBonus,
    activeSectorId: p.activeSectorId,
    isBot: Boolean(p.isBot),
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const invite = url.searchParams.get("invite");
  const { identity, setCookie } = await resolveIdentity();
  await ensurePlayer(identity, invite);

  const { sectors, players, economies, serverNow } = await loadAccruedState();
  const me = players[identity.id] ?? null;

  return withGuestCookie(
    NextResponse.json({
      sectors,
      players: Object.values(players).map(publicPlayer),
      economies,
      me,
      serverNow,
      costs: COSTS,
      authDisabled: AUTH_DISABLED,
    }),
    setCookie
  );
}

export async function POST(req: Request) {
  const { identity, setCookie } = await resolveIdentity();
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
  let me = players[id];
  if (!me) {
    return withGuestCookie(
      NextResponse.json({ error: "Player missing" }, { status: 500 }),
      setCookie
    );
  }

  const now = Date.now();

  if (body.action === "join_sector") {
    const sector = sectors.find((s) => s.id === body.sectorId);
    if (!sector) {
      return withGuestCookie(
        NextResponse.json({ error: "Unknown sector" }, { status: 404 }),
        setCookie
      );
    }
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return withGuestCookie(
        NextResponse.json(
          { error: "Drop your pin on the map first" },
          { status: 400 }
        ),
        setCookie
      );
    }
    if (!pointInRing({ lat, lng }, sector.ring)) {
      return withGuestCookie(
        NextResponse.json(
          {
            error:
              "Pin must be inside the sector. Tap inside the green/red zone.",
          },
          { status: 400 }
        ),
        setCookie
      );
    }

    players[id] = { ...me, activeSectorId: sector.id, updatedAt: now };
    if (!economies[sector.id]) {
      economies[sector.id] = {
        sectorId: sector.id,
        dugTotal: 0,
        lastTickAt: now,
        controllerId: null,
      };
    }
    await savePlayers(players);
    await saveEconomies(economies);
  } else if (body.action === "build_house") {
    if (!me.activeSectorId) {
      return withGuestCookie(
        NextResponse.json(
          { error: "Station in a sector before building" },
          { status: 400 }
        ),
        setCookie
      );
    }
    if (me.housesPlaced >= me.houseSlots) {
      return withGuestCookie(
        NextResponse.json(
          { error: "No house plots left — invite a friend for +1 plot" },
          { status: 400 }
        ),
        setCookie
      );
    }
    if (me.gold < COSTS.house) {
      return withGuestCookie(
        NextResponse.json(
          { error: `Need ${COSTS.house} gold to build a house` },
          { status: 400 }
        ),
        setCookie
      );
    }
    players[id] = {
      ...me,
      gold: me.gold - COSTS.house,
      housesPlaced: me.housesPlaced + 1,
      updatedAt: now,
    };
    await savePlayers(players);
  } else if (body.action === "recruit_villager") {
    if (!me.activeSectorId) {
      return withGuestCookie(
        NextResponse.json(
          { error: "Station in a sector to recruit" },
          { status: 400 }
        ),
        setCookie
      );
    }
    if (me.villagers >= maxVillagersAllowed(me)) {
      return withGuestCookie(
        NextResponse.json(
          {
            error:
              "Need another house first — each house shelters one more villager",
          },
          { status: 400 }
        ),
        setCookie
      );
    }
    if (me.gold < COSTS.villager) {
      return withGuestCookie(
        NextResponse.json(
          { error: `Need ${COSTS.villager} gold to recruit` },
          { status: 400 }
        ),
        setCookie
      );
    }
    players[id] = {
      ...me,
      gold: me.gold - COSTS.villager,
      villagers: me.villagers + 1,
      updatedAt: now,
    };
    await savePlayers(players);
  } else if (body.action === "upgrade_dig") {
    if (me.gold < COSTS.digBonus) {
      return withGuestCookie(
        NextResponse.json(
          { error: `Need ${COSTS.digBonus} gold for better tools` },
          { status: 400 }
        ),
        setCookie
      );
    }
    if (me.digBonus >= 3) {
      return withGuestCookie(
        NextResponse.json({ error: "Tools already maxed" }, { status: 400 }),
        setCookie
      );
    }
    players[id] = {
      ...me,
      gold: me.gold - COSTS.digBonus,
      digBonus: me.digBonus + 1,
      updatedAt: now,
    };
    await savePlayers(players);
  } else if (body.action === "leave_sector") {
    players[id] = { ...me, activeSectorId: null, updatedAt: now };
    await savePlayers(players);
  } else if (body.action === "rename") {
    const name = String((body as { name?: string }).name || "")
      .trim()
      .slice(0, 24);
    if (name.length < 2) {
      return withGuestCookie(
        NextResponse.json({ error: "Name too short" }, { status: 400 }),
        setCookie
      );
    }
    players[id] = { ...me, name, updatedAt: now };
    await savePlayers(players);
  } else {
    return withGuestCookie(
      NextResponse.json({ error: "Unknown action" }, { status: 400 }),
      setCookie
    );
  }

  const refreshed = await loadAccruedState();
  me = refreshed.players[id]!;
  return withGuestCookie(
    NextResponse.json({
      ok: true,
      me,
      economies: refreshed.economies,
      players: Object.values(refreshed.players).map(publicPlayer),
      serverNow: refreshed.serverNow || serverNow,
      costs: COSTS,
    }),
    setCookie
  );
}
