import { NextRequest, NextResponse } from "next/server";
import {
  deleteEntry,
  updateEntry,
  updateEntryStatus,
  type UpdateEntryInput,
} from "@/lib/airtable";
import { isAdminAuthorized } from "@/lib/adminAuth";
import { CATEGORIES } from "@/lib/constants";
import type { EntryStatus } from "@/lib/types";

type RouteContext = { params: { id: string } };

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function guard(request: NextRequest) {
  if (!isAdminAuthorized(request)) return unauthorized();
  return null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const blocked = guard(request);
  if (blocked) return blocked;

  const { id } = context.params;
  if (!id?.startsWith("rec")) {
    return NextResponse.json({ error: "Invalid entry id" }, { status: 400 });
  }

  try {
    const body = await request.json();

    // Quick status-only update
    if (
      body.status &&
      Object.keys(body).length === 1 &&
      ["pending", "approved", "rejected"].includes(body.status)
    ) {
      const entry = await updateEntryStatus(id, body.status as EntryStatus);
      return NextResponse.json({ success: true, entry });
    }

    const input: UpdateEntryInput = {};
    if (body.type === "event" || body.type === "place") input.type = body.type;
    if (typeof body.title === "string") input.title = body.title;
    if (typeof body.description === "string") input.description = body.description;
    if (
      typeof body.category === "string" &&
      (CATEGORIES as readonly string[]).includes(body.category)
    ) {
      input.category = body.category;
    }
    if (typeof body.organizerName === "string") {
      input.organizerName = body.organizerName;
    }
    if (body.lat === null || typeof body.lat === "number") input.lat = body.lat;
    if (body.lng === null || typeof body.lng === "number") input.lng = body.lng;
    if (body.locationText === null || typeof body.locationText === "string") {
      input.locationText = body.locationText ?? undefined;
    }
    if (body.sourceUrl === null || typeof body.sourceUrl === "string") {
      input.sourceUrl = body.sourceUrl ?? undefined;
    }
    if (body.contactPhone === null || typeof body.contactPhone === "string") {
      input.contactPhone = body.contactPhone ?? undefined;
    }
    if (body.eventDate === null || typeof body.eventDate === "string") {
      input.eventDate = body.eventDate ?? undefined;
    }
    if (body.eventEndDate === null || typeof body.eventEndDate === "string") {
      input.eventEndDate = body.eventEndDate ?? undefined;
    }
    if (
      body.status === "pending" ||
      body.status === "approved" ||
      body.status === "rejected"
    ) {
      input.status = body.status;
    }

    if (Object.keys(input).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    if (input.title != null && !input.title.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const entry = await updateEntry(id, input);
    return NextResponse.json({ success: true, entry });
  } catch (error) {
    console.error("Admin update entry failed:", error);
    const message =
      error instanceof Error ? error.message : "Could not update entry";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const blocked = guard(request);
  if (blocked) return blocked;

  const { id } = context.params;
  if (!id?.startsWith("rec")) {
    return NextResponse.json({ error: "Invalid entry id" }, { status: 400 });
  }

  try {
    await deleteEntry(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin delete entry failed:", error);
    return NextResponse.json(
      { error: "Could not delete entry" },
      { status: 500 }
    );
  }
}
