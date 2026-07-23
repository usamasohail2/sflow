import { NextRequest } from "next/server";

/** Shared secret for the hidden /manage admin UI. */
export function getAdminSecret(): string | null {
  const secret = process.env.ADMIN_SECRET?.trim();
  return secret || null;
}

/**
 * Temporarily open — no password required.
 * Re-enable the secret check before shipping.
 */
export function isAdminAuthorized(_request: NextRequest): boolean {
  void _request;
  return true;
}
