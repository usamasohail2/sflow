import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Canonical host for auth cookies + AUTH_URL.
 * Apex wars.usama.fun must redirect here or Google OAuth PKCE cookies
 * are set on one host and read on another → "sign in twice".
 */
const CANONICAL_HOST = "www.wars.usama.fun";

const APEX_HOSTS = new Set([
  "wars.usama.fun",
  "www.usama.fun",
  "usama.fun",
]);

export function middleware(req: NextRequest) {
  const host = req.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
  if (!host || host === CANONICAL_HOST) {
    return NextResponse.next();
  }

  // Local / preview / vercel.app — leave alone
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".vercel.app")
  ) {
    return NextResponse.next();
  }

  if (APEX_HOSTS.has(host)) {
    const url = req.nextUrl.clone();
    url.protocol = "https:";
    url.host = CANONICAL_HOST;
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * All app routes except static assets / Next internals.
     * Auth callbacks must also hit the canonical host.
     */
    "/((?!_next/static|_next/image|favicon.ico|sprites/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
  ],
};
