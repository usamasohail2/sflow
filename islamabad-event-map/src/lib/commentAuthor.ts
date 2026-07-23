/** Remembers a commenter's chosen display name across visits (cookie-based)
 * so we don't have to ask for it on every single comment. */
const COOKIE_NAME = "isb-explore-comment-name";
const MAX_AGE_DAYS = 365;

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

export function loadSavedCommentName(): string {
  try {
    return readCookie(COOKIE_NAME)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveCommentName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    writeCookie(COOKIE_NAME, trimmed, MAX_AGE_DAYS);
  } catch {
    // ignore
  }
}
