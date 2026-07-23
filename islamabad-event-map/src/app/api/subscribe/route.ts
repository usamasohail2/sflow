import { NextRequest, NextResponse } from "next/server";
import { subscribeEmail } from "@/lib/airtable";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 120;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Honeypot
    if (body.website) {
      return NextResponse.json({ success: true });
    }

    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { error: "Enter a valid email address" },
        { status: 400 }
      );
    }

    const result = await subscribeEmail(email);
    return NextResponse.json({
      success: true,
      alreadySubscribed: result.alreadySubscribed,
    });
  } catch (error) {
    console.error("Failed to subscribe:", error);
    const message =
      error instanceof Error && error.message.includes("NOT_FOUND")
        ? "Updates signup isn’t set up yet — check the Subscribers table in Airtable."
        : "Could not save your email. Try again in a moment.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
