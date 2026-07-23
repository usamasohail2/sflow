import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listChatMessages, postChatMessage } from "@/lib/chat";
import { isFounderEmail } from "@/lib/founder";

export const dynamic = "force-dynamic";

function isValidVisitorId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 64 &&
    /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    return null;
  }
  return session;
}

export async function GET(request: NextRequest) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const sinceRaw = request.nextUrl.searchParams.get("since");
  const since = sinceRaw ? Number(sinceRaw) : undefined;
  const messages = await listChatMessages(
    since != null && Number.isFinite(since) ? since : undefined
  );
  return NextResponse.json({ messages });
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }

    const body = await request.json();
    if (!isValidVisitorId(body.visitorId)) {
      return NextResponse.json({ error: "Invalid visitorId" }, { status: 400 });
    }

    const sessionName =
      typeof session.user?.name === "string"
        ? session.user.name.trim().split(/\s+/)[0]
        : undefined;

    const message = await postChatMessage({
      visitorId: body.visitorId,
      name: sessionName || body.name,
      text: body.text,
      color: body.color,
      star: isFounderEmail(session.user?.email),
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
