import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isFounderEmail } from "@/lib/founder";
import {
  hasSharedPresenceStore,
  listPresence,
  touchPresence,
} from "@/lib/presence";

export const dynamic = "force-dynamic";

function isValidVisitorId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 64 &&
    /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

export async function GET() {
  const explorers = await listPresence();
  return NextResponse.json({
    viewers: explorers.length,
    explorers,
    shared: hasSharedPresenceStore(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!isValidVisitorId(body.visitorId)) {
      return NextResponse.json({ error: "Invalid visitorId" }, { status: 400 });
    }

    const session = await auth();
    const star = isFounderEmail(session?.user?.email);

    const explorers = await touchPresence({
      visitorId: body.visitorId,
      name: typeof body.name === "string" ? body.name : undefined,
      lat: typeof body.lat === "number" ? body.lat : undefined,
      lng: typeof body.lng === "number" ? body.lng : undefined,
      alt: typeof body.alt === "number" ? body.alt : undefined,
      color: typeof body.color === "number" ? body.color : undefined,
      star,
    });

    return NextResponse.json({
      viewers: explorers.length,
      explorers,
      shared: hasSharedPresenceStore(),
    });
  } catch (error) {
    console.error("Presence error:", error);
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
