import { NextRequest, NextResponse } from "next/server";
import { createPendingEntry, fetchPublicEntries } from "@/lib/airtable";
import { CATEGORIES } from "@/lib/constants";
import {
  hashRequestIp,
  normalizeSubmitterId,
} from "@/lib/submitterSignals";
import type { CreateEntryInput, PhotoUpload } from "@/lib/types";

export const runtime = "nodejs";

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function GET() {
  try {
    const entries = await fetchPublicEntries();
    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Failed to fetch entries:", error);
    return NextResponse.json(
      { error: "Failed to fetch entries" },
      { status: 500 }
    );
  }
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function extensionFor(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  return "jpg";
}

async function parsePhotosFromForm(
  form: FormData
): Promise<{ photos?: PhotoUpload[]; error?: string }> {
  const files = form
    .getAll("photos")
    .filter((v): v is File => typeof File !== "undefined" && v instanceof File);

  if (files.length === 0) return { photos: [] };
  if (files.length > MAX_PHOTOS) {
    return { error: `You can upload up to ${MAX_PHOTOS} photos` };
  }

  const photos: PhotoUpload[] = [];
  for (const file of files) {
    if (!ALLOWED_TYPES.has(file.type)) {
      return {
        error: "Photos must be JPEG, PNG, WebP, or GIF",
      };
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return { error: "Each photo must be under 2 MB" };
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName =
      file.name?.replace(/[^\w.\-]+/g, "_").slice(0, 80) ||
      `photo.${extensionFor(file.type)}`;
    photos.push({
      filename: safeName,
      contentType: file.type,
      data: buffer,
    });
  }
  return { photos };
}

type ParsedBody = {
  website?: string;
  type: "event" | "place";
  title: string;
  description?: string;
  category: string;
  organizerName: string;
  lat?: number;
  lng?: number;
  locationTbd: boolean;
  locationText?: string;
  sourceUrl?: string;
  contactPhone?: string;
  eventDate?: string;
  eventEndDate?: string;
  submitterId?: string;
  photos: PhotoUpload[];
};

async function parseRequest(request: NextRequest): Promise<ParsedBody> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const photoResult = await parsePhotosFromForm(form);
    if (photoResult.error) {
      throw Object.assign(new Error(photoResult.error), { status: 400 });
    }

    const latRaw = form.get("lat");
    const lngRaw = form.get("lng");
    return {
      website: String(form.get("website") ?? ""),
      type: String(form.get("type") ?? "") === "place" ? "place" : "event",
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? "").trim() || undefined,
      category: String(form.get("category") ?? ""),
      organizerName: String(form.get("organizerName") ?? "").trim(),
      lat: latRaw != null && String(latRaw) !== "" ? Number(latRaw) : undefined,
      lng: lngRaw != null && String(lngRaw) !== "" ? Number(lngRaw) : undefined,
      locationTbd:
        String(form.get("locationTbd") ?? "") === "true" ||
        String(form.get("locationTbd") ?? "") === "1",
      locationText: String(form.get("locationText") ?? "").trim() || undefined,
      sourceUrl: String(form.get("sourceUrl") ?? "").trim() || undefined,
      contactPhone: String(form.get("contactPhone") ?? "").trim() || undefined,
      eventDate: String(form.get("eventDate") ?? "") || undefined,
      eventEndDate: String(form.get("eventEndDate") ?? "") || undefined,
      submitterId: String(form.get("submitterId") ?? "").trim() || undefined,
      photos: photoResult.photos ?? [],
    };
  }

  const body = await request.json();
  return {
    website: body.website ? String(body.website) : "",
    type: body.type === "place" ? "place" : "event",
    title: String(body.title ?? "").trim(),
    description: body.description
      ? String(body.description).trim()
      : undefined,
    category: String(body.category ?? ""),
    organizerName: String(body.organizerName ?? "").trim(),
    lat: body.lat != null ? Number(body.lat) : undefined,
    lng: body.lng != null ? Number(body.lng) : undefined,
    locationTbd: Boolean(body.locationTbd),
    locationText: body.locationText
      ? String(body.locationText).trim()
      : undefined,
    sourceUrl: body.sourceUrl ? String(body.sourceUrl).trim() : undefined,
    contactPhone: body.contactPhone
      ? String(body.contactPhone).trim()
      : undefined,
    eventDate: body.eventDate ? String(body.eventDate) : undefined,
    eventEndDate: body.eventEndDate ? String(body.eventEndDate) : undefined,
    submitterId: body.submitterId
      ? String(body.submitterId).trim()
      : undefined,
    photos: [],
  };
}

export async function POST(request: NextRequest) {
  try {
    let parsed: ParsedBody;
    try {
      parsed = await parseRequest(request);
    } catch (error) {
      const status =
        error &&
        typeof error === "object" &&
        "status" in error &&
        typeof (error as { status: unknown }).status === "number"
          ? (error as { status: number }).status
          : 400;
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Invalid submission",
        },
        { status }
      );
    }

    // Honeypot spam protection
    if (parsed.website) {
      return NextResponse.json({ success: true });
    }

    const {
      type,
      title,
      description,
      category,
      organizerName,
      lat,
      lng,
      locationTbd,
      sourceUrl,
      contactPhone,
      eventDate,
      eventEndDate,
      photos,
    } = parsed;
    let { locationText } = parsed;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    if (!organizerName || organizerName.length < 2) {
      return NextResponse.json(
        { error: "Your name is required" },
        { status: 400 }
      );
    }

    if (organizerName.length > 80) {
      return NextResponse.json(
        { error: "Name is too long" },
        { status: 400 }
      );
    }

    if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
      return NextResponse.json(
        { error: "Valid category is required" },
        { status: 400 }
      );
    }

    const hasCoords =
      lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng);

    if (type === "place") {
      if (!hasCoords && !locationText) {
        return NextResponse.json(
          {
            error:
              "Places require a location — pin it on the map or describe the area",
          },
          { status: 400 }
        );
      }
    }

    if (type === "event") {
      if (locationTbd) {
        locationText = "Location not finalised yet";
      } else if (!hasCoords && !locationText) {
        return NextResponse.json(
          {
            error:
              "Choose a location, describe an area, or mark location as not finalised yet",
          },
          { status: 400 }
        );
      }

      if (!eventDate) {
        return NextResponse.json(
          { error: "Event date is required for events" },
          { status: 400 }
        );
      }
    }

    if (sourceUrl && !isValidUrl(sourceUrl)) {
      return NextResponse.json(
        { error: "Source URL must be a valid URL" },
        { status: 400 }
      );
    }

    if (contactPhone && contactPhone.length > 40) {
      return NextResponse.json(
        { error: "Contact number is too long" },
        { status: 400 }
      );
    }

    const input: CreateEntryInput = {
      type,
      title,
      description,
      category: category as CreateEntryInput["category"],
      organizerName,
      lat: hasCoords && !locationTbd ? lat : undefined,
      lng: hasCoords && !locationTbd ? lng : undefined,
      locationText: locationTbd ? locationText : locationText || undefined,
      sourceUrl: sourceUrl || undefined,
      contactPhone: contactPhone || undefined,
      eventDate: type === "event" ? eventDate : undefined,
      eventEndDate:
        type === "event" && eventEndDate ? eventEndDate : undefined,
      submitterId: normalizeSubmitterId(parsed.submitterId),
      ipHash: hashRequestIp(request),
    };

    const { entry, photoWarning } = await createPendingEntry(input, photos);
    return NextResponse.json({
      success: true,
      id: entry.id,
      photoWarning: photoWarning || undefined,
    });
  } catch (error) {
    console.error("Failed to create entry:", error);
    return NextResponse.json(
      { error: "Failed to submit entry" },
      { status: 500 }
    );
  }
}
