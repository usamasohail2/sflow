import { NextRequest, NextResponse } from "next/server";
import {
  getPresenceCount,
  hasSharedPresenceStore,
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
  const viewers = await getPresenceCount();
  return NextResponse.json({
    viewers,
    shared: hasSharedPresenceStore(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!isValidVisitorId(body.visitorId)) {
      return NextResponse.json({ error: "Invalid visitorId" }, { status: 400 });
    }

    const viewers = await touchPresence(body.visitorId);
    return NextResponse.json({
      viewers,
      shared: hasSharedPresenceStore(),
    });
  } catch (error) {
    console.error("Presence error:", error);
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
