import { NextRequest, NextResponse } from "next/server";
import {
  getPresenceSnapshot,
  hasSharedPresenceStore,
  isValidCameraPose,
  isValidDisplayName,
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
  const snap = await getPresenceSnapshot();
  return NextResponse.json({
    viewers: snap.viewers,
    peers: snap.peers,
    shared: hasSharedPresenceStore(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!isValidVisitorId(body.visitorId)) {
      return NextResponse.json({ error: "Invalid visitorId" }, { status: 400 });
    }

    const camera = isValidCameraPose(body.camera)
      ? body.camera
      : isValidCameraPose({ lat: body.lat, lng: body.lng })
        ? { lat: body.lat as number, lng: body.lng as number }
        : null;

    const name = isValidDisplayName(body.name) ? body.name.trim() : null;

    const snap = await touchPresence(body.visitorId, { camera, name });
    return NextResponse.json({
      viewers: snap.viewers,
      peers: snap.peers,
      shared: hasSharedPresenceStore(),
    });
  } catch (error) {
    console.error("Presence error:", error);
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
