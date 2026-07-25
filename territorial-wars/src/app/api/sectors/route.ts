import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { Sector } from "@/lib/gameTypes";
import { closeRing } from "@/lib/geo";
import { AUTH_DISABLED } from "@/lib/devMode";
import { getSectors, saveSectors } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const sectors = await getSectors();
  return NextResponse.json({ sectors });
}

export async function PUT(req: Request) {
  if (!AUTH_DISABLED) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
  }

  const body = (await req.json()) as { sectors?: Sector[] };
  if (!Array.isArray(body.sectors)) {
    return NextResponse.json({ error: "Invalid sectors" }, { status: 400 });
  }

  const now = Date.now();
  const existing = await getSectors();
  const byId = new Map(existing.map((s) => [s.id, s]));

  const sectors: Sector[] = body.sectors
    .map((raw) => {
      const name = String(raw.name || "").trim();
      const ring = Array.isArray(raw.ring)
        ? (raw.ring.filter(
            (p) => Array.isArray(p) && p.length >= 2
          ) as [number, number][])
        : [];
      if (!name || ring.length < 3) return null;
      const id =
        typeof raw.id === "string" && raw.id.trim()
          ? raw.id.trim()
          : `sec_${Math.random().toString(36).slice(2, 10)}`;
      const prev = byId.get(id);
      return {
        id,
        name,
        ring: closeRing(ring),
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      } satisfies Sector;
    })
    .filter(Boolean) as Sector[];

  await saveSectors(sectors);
  return NextResponse.json({ sectors });
}
