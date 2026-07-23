import { NextRequest, NextResponse } from "next/server";
import { listChatMessages, postChatMessage } from "@/lib/chat";

export const dynamic = "force-dynamic";

function isValidVisitorId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 64 &&
    /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

export async function GET(request: NextRequest) {
  const sinceRaw = request.nextUrl.searchParams.get("since");
  const since = sinceRaw ? Number(sinceRaw) : undefined;
  const messages = await listChatMessages(
    since != null && Number.isFinite(since) ? since : undefined
  );
  return NextResponse.json({ messages });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!isValidVisitorId(body.visitorId)) {
      return NextResponse.json({ error: "Invalid visitorId" }, { status: 400 });
    }

    const message = await postChatMessage({
      visitorId: body.visitorId,
      name: body.name,
      text: body.text,
      color: body.color,
      lat: body.lat,
      lng: body.lng,
    });

    if (!message) {
      return NextResponse.json({ error: "Empty message" }, { status: 400 });
    }

    const messages = await listChatMessages();
    return NextResponse.json({ message, messages });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
