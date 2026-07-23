import { NextRequest, NextResponse } from "next/server";
import { createComment, fetchCommentsForEntry } from "@/lib/airtable";

export async function GET(request: NextRequest) {
  try {
    const entryId = request.nextUrl.searchParams.get("entryId")?.trim();
    if (!entryId) {
      return NextResponse.json(
        { error: "entryId is required" },
        { status: 400 }
      );
    }

    const comments = await fetchCommentsForEntry(entryId);
    return NextResponse.json({ comments });
  } catch (error) {
    console.error("Failed to fetch comments:", error);
    const message =
      error instanceof Error && error.message.includes("NOT_FOUND")
        ? "Comments aren’t set up yet — add a Comments table in Airtable."
        : "Could not load comments.";
    return NextResponse.json({ error: message, comments: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Honeypot
    if (body.website) {
      return NextResponse.json({ success: true });
    }

    const entryId = String(body.entryId ?? "").trim();
    const commentBody = String(body.body ?? "").trim();
    const authorName = String(body.authorName ?? "").trim();

    if (!entryId) {
      return NextResponse.json({ error: "Missing listing" }, { status: 400 });
    }
    if (!commentBody) {
      return NextResponse.json(
        { error: "Write a comment first" },
        { status: 400 }
      );
    }
    if (commentBody.length > 500) {
      return NextResponse.json(
        { error: "Comment is too long (max 500 characters)" },
        { status: 400 }
      );
    }
    if (authorName.length > 40) {
      return NextResponse.json(
        { error: "Name is too long (max 40 characters)" },
        { status: 400 }
      );
    }

    const comment = await createComment({
      entryId,
      body: commentBody,
      authorName: authorName || undefined,
    });

    return NextResponse.json({ success: true, comment });
  } catch (error) {
    console.error("Failed to create comment:", error);
    const message =
      error instanceof Error && error.message.includes("NOT_FOUND")
        ? "Comments aren’t set up yet — add a Comments table in Airtable."
        : error instanceof Error
          ? error.message
          : "Could not post your comment. Try again in a moment.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
