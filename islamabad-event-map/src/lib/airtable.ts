import Airtable, { FieldSet, Records } from "airtable";
import { normalizeCategory, type Category } from "./constants";
import type {
  Comment,
  CreateCommentInput,
  CreateEntryInput,
  Entry,
  EntryStatus,
  PhotoUpload,
} from "./types";
import { generateUsername } from "./usernames";

const TABLE_NAME = "Entries";
const PHOTOS_FIELD = "Photos";

function getBase() {
  const apiKey = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;

  if (!apiKey || !baseId) {
    throw new Error("Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID");
  }

  return new Airtable({ apiKey }).base(baseId);
}

function getCredentials() {
  const apiKey = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    throw new Error("Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID");
  }
  return { apiKey, baseId };
}

function parseCategory(value: unknown): Category {
  return normalizeCategory(value);
}

function parseType(value: unknown): "event" | "place" {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "place" ? "place" : "event";
}

function parseStatus(value: unknown): EntryStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "approved" || normalized === "rejected") return normalized;
  return "pending";
}

function parsePhotos(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const urls: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const att = item as {
      url?: string;
      thumbnails?: { large?: { url?: string }; full?: { url?: string } };
    };
    const url =
      att.thumbnails?.large?.url ||
      att.thumbnails?.full?.url ||
      att.url;
    if (url) urls.push(url);
  }
  return urls.length > 0 ? urls : undefined;
}

function mapRecord(record: Airtable.Record<FieldSet>): Entry {
  const fields = record.fields;
  const rawDescription = fields.Description
    ? String(fields.Description)
    : undefined;
  const contactFromDesc = rawDescription
    ?.match(/^Contact:\s*(.+)$/im)?.[1]
    ?.trim();
  const organizerFromDesc = rawDescription
    ?.match(/^Organizer:\s*(.+)$/im)?.[1]
    ?.trim();
  const submitterFromDesc = rawDescription
    ?.match(/^SubmitterId:\s*(.+)$/im)?.[1]
    ?.trim();
  const ipHashFromDesc = rawDescription
    ?.match(/^IpHash:\s*(.+)$/im)?.[1]
    ?.trim();
  const organizerFromField = fields.Organizer
    ? String(fields.Organizer).trim()
    : "";
  const submitterFromField = fields.SubmitterId
    ? String(fields.SubmitterId).trim()
    : "";
  const ipHashFromField = fields.IpHash ? String(fields.IpHash).trim() : "";

  // Never expose admin signal lines in the public description body
  const description = rawDescription
    ? rawDescription
        .replace(/^SubmitterId:\s*.+$/gim, "")
        .replace(/^IpHash:\s*.+$/gim, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim() || undefined
    : undefined;

  return {
    id: record.id,
    type: parseType(fields.Type),
    title: String(fields.Title ?? ""),
    description,
    category: parseCategory(fields.Category),
    organizerName: organizerFromField || organizerFromDesc || "",
    lat: typeof fields.Lat === "number" ? fields.Lat : undefined,
    lng: typeof fields.Lng === "number" ? fields.Lng : undefined,
    locationText: fields.LocationText
      ? String(fields.LocationText)
      : undefined,
    sourceUrl: fields.SourceURL ? String(fields.SourceURL) : undefined,
    contactPhone: contactFromDesc || undefined,
    eventDate: fields.EventDate ? String(fields.EventDate) : undefined,
    eventEndDate: fields.EventEndDate
      ? String(fields.EventEndDate)
      : undefined,
    imageUrls: parsePhotos(fields.Photos),
    status: parseStatus(fields.Status),
    createdTime: record._rawJson.createdTime,
    submitterId: submitterFromField || submitterFromDesc || undefined,
    ipHash: ipHashFromField || ipHashFromDesc || undefined,
  };
}

/** Public listings: approved + pending (rejected stay hidden). */
export async function fetchPublicEntries(): Promise<Entry[]> {
  const records: Records<FieldSet> = await getBase()(TABLE_NAME)
    .select({
      // Case-insensitive; blank Status treated as pending; hide rejected
      filterByFormula:
        "OR(LOWER({Status}) = 'approved', LOWER({Status}) = 'pending', {Status} = BLANK())",
    })
    .all();

  return records.map((record) => {
    const entry = mapRecord(record);
    // Keep device signals admin-only
    delete entry.submitterId;
    delete entry.ipHash;
    return entry;
  });
}

function buildDescription(
  input: CreateEntryInput,
  options: {
    includeOrganizerInDescription: boolean;
    includeSubmitterSignalsInDescription: boolean;
  }
): string | undefined {
  const metaLines: string[] = [];
  if (options.includeOrganizerInDescription) {
    metaLines.push(`Organizer: ${input.organizerName.trim()}`);
  }
  if (input.contactPhone?.trim()) {
    metaLines.push(`Contact: ${input.contactPhone.trim()}`);
  }
  if (options.includeSubmitterSignalsInDescription) {
    if (input.submitterId?.trim()) {
      metaLines.push(`SubmitterId: ${input.submitterId.trim()}`);
    }
    if (input.ipHash?.trim()) {
      metaLines.push(`IpHash: ${input.ipHash.trim()}`);
    }
  }
  const body = input.description?.trim() ?? "";
  if (metaLines.length === 0) return body || undefined;
  return body ? `${metaLines.join("\n")}\n\n${body}` : metaLines.join("\n");
}

function isUnknownFieldError(error: unknown, fieldName: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes(`Unknown field name: "${fieldName}"`) ||
    message.includes(`Unknown field name: '${fieldName}'`) ||
    (message.includes("UNKNOWN_FIELD_NAME") && message.includes(fieldName))
  );
}

async function uploadPhotoToRecord(
  recordId: string,
  photo: PhotoUpload
): Promise<void> {
  const { apiKey, baseId } = getCredentials();
  // Content uploads use content.airtable.com (not api.airtable.com)
  const url = `https://content.airtable.com/v0/${baseId}/${recordId}/${encodeURIComponent(
    PHOTOS_FIELD
  )}/uploadAttachment`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contentType: photo.contentType,
      filename: photo.filename,
      file: photo.data.toString("base64"),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Photo upload failed (${res.status}): ${text}`);
  }
}

function isPhotosSetupError(error: unknown): boolean {
  if (isUnknownFieldError(error, PHOTOS_FIELD)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("UNKNOWN_FIELD_NAME") ||
    message.includes("INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND") ||
    message.includes('"NOT_FOUND"') ||
    message.includes("Photo upload failed (403)") ||
    message.includes("Photo upload failed (404)")
  );
}

export async function createPendingEntry(
  input: CreateEntryInput,
  photos: PhotoUpload[] = []
): Promise<{ entry: Entry; photoWarning?: string }> {
  const organizer = input.organizerName.trim();
  if (!organizer) {
    throw new Error("Your name is required");
  }

  // Airtable single-select options are capitalized: Event / Place
  const baseFields: FieldSet = {
    Type: input.type === "place" ? "Place" : "Event",
    Title: input.title,
    Category: input.category,
    Status: "pending",
    Organizer: organizer,
  };

  if (input.lat != null) baseFields.Lat = input.lat;
  if (input.lng != null) baseFields.Lng = input.lng;
  if (input.locationText) baseFields.LocationText = input.locationText;
  if (input.sourceUrl) baseFields.SourceURL = input.sourceUrl;
  if (input.eventDate) baseFields.EventDate = input.eventDate;
  if (input.eventEndDate) baseFields.EventEndDate = input.eventEndDate;
  if (input.submitterId) baseFields.SubmitterId = input.submitterId;
  if (input.ipHash) baseFields.IpHash = input.ipHash;

  const table = getBase()(TABLE_NAME);

  let record: Airtable.Record<FieldSet>;
  let includeOrganizerInDescription = false;
  let includeSubmitterSignalsInDescription = false;

  const tryCreate = async (fields: FieldSet) => {
    const description = buildDescription(input, {
      includeOrganizerInDescription,
      includeSubmitterSignalsInDescription,
    });
    const next = { ...fields };
    if (description) next.Description = description;
    else delete next.Description;
    return table.create([{ fields: next }]);
  };

  try {
    const created = await tryCreate(baseFields);
    record = created[0];
  } catch (error) {
    const fields: FieldSet = { ...baseFields };
    let changed = false;

    if (isUnknownFieldError(error, "Organizer")) {
      console.warn(
        'Airtable is missing an "Organizer" single-line text field on Entries. ' +
          "Add it in Airtable so names are queryable as a real column."
      );
      delete fields.Organizer;
      includeOrganizerInDescription = true;
      changed = true;
    }
    if (
      isUnknownFieldError(error, "SubmitterId") ||
      isUnknownFieldError(error, "IpHash")
    ) {
      console.warn(
        'Airtable is missing "SubmitterId" / "IpHash" single-line text fields on Entries. ' +
          "Add them for cleaner admin grouping (signals will fall back into Description)."
      );
      delete fields.SubmitterId;
      delete fields.IpHash;
      includeSubmitterSignalsInDescription = true;
      changed = true;
    }

    if (!changed) throw error;

    try {
      const created = await tryCreate(fields);
      record = created[0];
    } catch (retryError) {
      // Organizer may have worked but signal fields failed on second attempt, or vice versa
      if (
        isUnknownFieldError(retryError, "SubmitterId") ||
        isUnknownFieldError(retryError, "IpHash")
      ) {
        delete fields.SubmitterId;
        delete fields.IpHash;
        includeSubmitterSignalsInDescription = true;
        const created = await tryCreate(fields);
        record = created[0];
      } else if (isUnknownFieldError(retryError, "Organizer")) {
        delete fields.Organizer;
        includeOrganizerInDescription = true;
        const created = await tryCreate(fields);
        record = created[0];
      } else {
        throw retryError;
      }
    }
  }

  if (photos.length > 0) {
    try {
      for (const photo of photos) {
        await uploadPhotoToRecord(record.id, photo);
      }
      // Re-fetch so response includes attachment URLs
      const refreshed = await table.find(record.id);
      return { entry: mapRecord(refreshed) };
    } catch (error) {
      console.error("Failed to upload listing photos:", error);
      const photoWarning = isPhotosSetupError(error)
        ? 'Listing saved, but photos need an Airtable Attachment field named "Photos" on Entries.'
        : "Listing saved, but photo upload failed. Try again or add the photo in Airtable.";
      return { entry: mapRecord(record), photoWarning };
    }
  }

  return { entry: mapRecord(record) };
}

/** All listings for admin (includes rejected; skips presence heartbeat rows). */
export async function fetchAllEntries(): Promise<Entry[]> {
  const records: Records<FieldSet> = await getBase()(TABLE_NAME).select().all();

  return records
    .map(mapRecord)
    .filter((e) => !e.title.startsWith("__presence__:"))
    .sort((a, b) => {
      const order = { pending: 0, approved: 1, rejected: 2 } as const;
      const byStatus = order[a.status] - order[b.status];
      if (byStatus !== 0) return byStatus;
      return (
        new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime()
      );
    });
}

export async function updateEntryStatus(
  id: string,
  status: EntryStatus
): Promise<Entry> {
  const table = getBase()(TABLE_NAME);
  const updated = await table.update([
    { id, fields: { Status: status } },
  ]);
  return mapRecord(updated[0]);
}

export type UpdateEntryInput = Partial<
  Pick<
    CreateEntryInput,
    | "type"
    | "title"
    | "description"
    | "category"
    | "organizerName"
    | "lat"
    | "lng"
    | "locationText"
    | "sourceUrl"
    | "contactPhone"
    | "eventDate"
    | "eventEndDate"
  >
> & { status?: EntryStatus };

export async function updateEntry(
  id: string,
  input: UpdateEntryInput
): Promise<Entry> {
  const table = getBase()(TABLE_NAME);
  const fields: Record<string, unknown> = {};

  if (input.type != null) {
    fields.Type = input.type === "place" ? "Place" : "Event";
  }
  if (input.title != null) fields.Title = input.title.trim();
  if (input.category != null) fields.Category = input.category;
  if (input.status != null) fields.Status = input.status;
  if (input.organizerName != null) {
    fields.Organizer = input.organizerName.trim();
  }
  if (input.lat !== undefined) {
    fields.Lat = input.lat == null ? null : input.lat;
  }
  if (input.lng !== undefined) {
    fields.Lng = input.lng == null ? null : input.lng;
  }
  if (input.locationText !== undefined) {
    fields.LocationText = input.locationText?.trim() || null;
  }
  if (input.sourceUrl !== undefined) {
    fields.SourceURL = input.sourceUrl?.trim() || null;
  }
  if (input.eventDate !== undefined) {
    fields.EventDate = input.eventDate?.trim() || null;
  }
  if (input.eventEndDate !== undefined) {
    fields.EventEndDate = input.eventEndDate?.trim() || null;
  }

  // Rebuild Description when description and/or contact change
  if (input.description !== undefined || input.contactPhone !== undefined) {
    const existing = await table.find(id);
    const current = mapRecord(existing);
    const description = buildDescription(
      {
        type: input.type ?? current.type,
        title: input.title ?? current.title,
        category: input.category ?? current.category,
        organizerName: input.organizerName ?? current.organizerName,
        description:
          input.description !== undefined
            ? input.description
            : current.description
                ?.replace(/^Contact:\s*.+$/im, "")
                .replace(/^Organizer:\s*.+$/im, "")
                .trim(),
        contactPhone:
          input.contactPhone !== undefined
            ? input.contactPhone
            : current.contactPhone,
        submitterId: current.submitterId,
        ipHash: current.ipHash,
      },
      {
        includeOrganizerInDescription: false,
        // Keep description-fallback signals if Airtable columns were never added
        includeSubmitterSignalsInDescription: Boolean(
          current.submitterId || current.ipHash
        ),
      }
    );
    fields.Description = description || null;
  }

  const asFieldSet = fields as FieldSet;

  try {
    const updated = await table.update([{ id, fields: asFieldSet }]);
    return mapRecord(updated[0]);
  } catch (error) {
    if (!isUnknownFieldError(error, "Organizer") || input.organizerName == null) {
      throw error;
    }
    const withoutOrganizer = { ...fields };
    delete withoutOrganizer.Organizer;
    const updated = await table.update([
      { id, fields: withoutOrganizer as FieldSet },
    ]);
    return mapRecord(updated[0]);
  }
}

export async function deleteEntry(id: string): Promise<void> {
  await getBase()(TABLE_NAME).destroy([id]);
}

const SUBSCRIBERS_TABLE = "Subscribers";

export async function subscribeEmail(
  email: string
): Promise<{ alreadySubscribed: boolean }> {
  const base = getBase();
  const normalized = email.trim().toLowerCase();
  const escaped = normalized.replace(/'/g, "\\'");

  const existing = await base(SUBSCRIBERS_TABLE)
    .select({
      filterByFormula: `LOWER({Email}) = '${escaped}'`,
      maxRecords: 1,
    })
    .firstPage();

  if (existing.length > 0) {
    return { alreadySubscribed: true };
  }

  try {
    await base(SUBSCRIBERS_TABLE).create([
      {
        fields: {
          Email: normalized,
          Status: "active",
        },
      },
    ]);
  } catch {
    // Status column is optional — retry with Email only
    await base(SUBSCRIBERS_TABLE).create([
      {
        fields: {
          Email: normalized,
        },
      },
    ]);
  }

  return { alreadySubscribed: false };
}

const COMMENTS_TABLE = "Comments";

function escapeFormulaString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function mapCommentRecord(record: Airtable.Record<FieldSet>): Comment {
  const fields = record.fields;
  const entryIdField = fields.EntryId ? String(fields.EntryId).trim() : "";
  const linked = fields.Entry;
  const linkedId =
    Array.isArray(linked) && linked.length > 0 ? String(linked[0]) : "";

  return {
    id: record.id,
    entryId: entryIdField || linkedId,
    body: String(fields.Body ?? "").trim(),
    authorName: String(fields.AuthorName ?? "Anonymous").trim() || "Anonymous",
    status: parseStatus(fields.Status),
    createdTime: record._rawJson.createdTime,
  };
}

/** Public comments for a listing — approved (or blank Status); rejected stay hidden. */
export async function fetchCommentsForEntry(entryId: string): Promise<Comment[]> {
  const escaped = escapeFormulaString(entryId);
  const table = getBase()(COMMENTS_TABLE);

  let records: Records<FieldSet>;
  try {
    records = await table
      .select({
        filterByFormula: `AND(
          {EntryId} = '${escaped}',
          OR(LOWER({Status}) = 'approved', {Status} = BLANK())
        )`,
      })
      .all();
  } catch {
    // Status column optional
    records = await table
      .select({
        filterByFormula: `{EntryId} = '${escaped}'`,
      })
      .all();
  }

  return records
    .map(mapCommentRecord)
    .filter((c) => c.status !== "rejected")
    .sort(
      (a, b) =>
        new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime()
    );
}

export async function createComment(
  input: CreateCommentInput
): Promise<Comment> {
  const body = input.body.trim();
  if (!body) throw new Error("Comment is required");
  if (body.length > 500) throw new Error("Comment is too long (max 500 characters)");
  if (!input.entryId.trim()) throw new Error("Missing listing");

  const authorName = input.authorName?.trim() || generateUsername();

  if (authorName.length > 40) {
    throw new Error("Name is too long (max 40 characters)");
  }

  const entryId = input.entryId.trim();
  const table = getBase()(COMMENTS_TABLE);

  const attempts: FieldSet[] = [
    {
      EntryId: entryId,
      Body: body,
      AuthorName: authorName,
      Status: "approved",
    },
    {
      EntryId: entryId,
      Body: body,
      AuthorName: authorName,
    },
  ];

  let lastError: unknown;
  for (const fields of attempts) {
    try {
      const created = await table.create([{ fields }]);
      return mapCommentRecord(created[0]);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not save comment");
}
