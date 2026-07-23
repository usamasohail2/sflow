import { createHash } from "crypto";
import type { NextRequest } from "next/server";

const SUBMITTER_ID_RE = /^[a-zA-Z0-9_-]{8,80}$/;

/** Soft-validate client-provided anonymous submitter id. */
export function normalizeSubmitterId(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const value = String(raw).trim();
  if (!SUBMITTER_ID_RE.test(value)) return undefined;
  return value;
}

function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip")?.trim();
  return real || null;
}

function hashSalt(): string {
  return (
    process.env.SUBMITTER_SALT?.trim() ||
    process.env.ADMIN_SECRET?.trim() ||
    "isb-explore-dev"
  );
}

/** Short daily-rotated IP hash — weak corroboration only, not raw IP storage. */
export function hashRequestIp(request: NextRequest): string | undefined {
  const ip = clientIp(request);
  if (!ip) return undefined;
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256")
    .update(`${day}:${hashSalt()}:${ip}`)
    .digest("hex")
    .slice(0, 16);
}
