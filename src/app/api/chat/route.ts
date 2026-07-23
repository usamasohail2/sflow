import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  countMessagesByVisitor,
  listChatMessages,
  postChatMessage,
} from "@/lib/chat";
import { isFounderEmail } from "@/lib/founder";

export const dynamic = "force-dynamic";

const GUEST_MESSAGE_LIMIT = 1;

function isValidVisitorId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 64 &&
    /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

/** Anyone can read chat */
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
    const session = await auth();
    const signedIn = Boolean(session?.user);
    const body = await request.json();

    if (!isValidVisitorId(body.visitorId)) {
      return NextResponse.json({ error: "Invalid visitorId" }, { status: 400 });
    }

    if (!signedIn) {
      const prior = await countMessagesByVisitor(body.visitorId);
      if (prior >= GUEST_MESSAGE_LIMIT) {
        return NextResponse.json(
          {
            error: "Sign in to send more messages",
            code: "LOGIN_REQUIRED",
            guestLimit: GUEST_MESSAGE_LIMIT,
          },
          { status: 403 }
        );
      }
    }

    const sessionName =
      typeof session?.user?.name === "string"
        ? session.user.name.trim().split(/\s+/)[0]
        : undefined;

    const message = await postChatMessage({
      visitorId: body.visitorId,
      name: signedIn ? sessionName || body.name : body.name,
      text: body.text,
      color: body.color,
      star: signedIn ? isFounderEmail(session?.user?.email) : false,
      lat: body.lat,
      lng: body.lng,
    });

    if (!message) {
      return NextResponse.json({ error: "Empty message" }, { status: 400 });
    }

    const messages = await listChatMessages();
    return NextResponse.json({
      message,
      messages,
      guestRemaining: signedIn
        ? null
        : Math.max(
            0,
            GUEST_MESSAGE_LIMIT -
              (await countMessagesByVisitor(body.visitorId))
          ),
    });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
