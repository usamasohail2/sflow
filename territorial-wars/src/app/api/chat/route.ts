import { NextRequest, NextResponse } from "next/server";
import {
  hasSharedPresenceStore,
  isValidChatText,
  isValidDisplayName,
  listChatMessages,
  postChatMessage,
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
  const messages = await listChatMessages();
  return NextResponse.json({
    messages,
    shared: hasSharedPresenceStore(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Honeypot
    if (typeof body.website === "string" && body.website.trim()) {
      return NextResponse.json({ ok: true, messages: [] });
    }

    if (!isValidVisitorId(body.visitorId)) {
      return NextResponse.json({ error: "Invalid visitorId" }, { status: 400 });
    }
    if (!isValidDisplayName(body.name)) {
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }
    if (!isValidChatText(body.text)) {
      return NextResponse.json({ error: "Invalid message" }, { status: 400 });
    }

    const result = await postChatMessage({
      visitorId: body.visitorId,
      name: body.name,
      text: body.text,
    });
    if (!result) {
      return NextResponse.json({ error: "Invalid message" }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      message: result.message,
      messages: result.messages,
      shared: hasSharedPresenceStore(),
    });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
