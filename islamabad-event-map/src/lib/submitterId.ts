/** Anonymous browser identity for linking submissions from the same device. */
const COOKIE_NAME = "isb-explore-submitter-id";
const MAX_AGE_DAYS = 400;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string, days: number) {
  if (typeof document === "undefined") return;
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Returns existing cookie id, or creates and stores a new one. */
export function getOrCreateSubmitterId(): string {
  try {
    const existing = readCookie(COOKIE_NAME)?.trim();
    if (existing && existing.length >= 8 && existing.length <= 80) {
      return existing;
    }
    const id = newId();
    writeCookie(COOKIE_NAME, id, MAX_AGE_DAYS);
    return id;
  } catch {
    return newId();
  }
}
