import type { Sector } from "@/lib/gameTypes";
import { closeRing } from "@/lib/geo";

/**
 * Guest-cookie mode for local testing.
 * Default: Google auth on. Set AUTH_DISABLED=true to use guests.
 */
export const AUTH_DISABLED =
  process.env.AUTH_DISABLED === "true" ||
  process.env.NEXT_PUBLIC_AUTH_DISABLED === "true";

/**
 * Comma-separated Google emails allowed to edit sectors.
 * Defaults to the project owner — override with ADMIN_EMAILS in Vercel.
 */
export function isAdminEmail(email?: string | null): boolean {
  if (AUTH_DISABLED) return true;
  const raw =
    process.env.ADMIN_EMAILS ||
    process.env.NEXT_PUBLIC_ADMIN_EMAILS ||
    "xalion.malik@gmail.com";
  const allow = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const e = email?.trim().toLowerCase();
  return Boolean(e && allow.includes(e));
}

/** Starter sectors with real-ish Islamabad names for local play */
export function buildDummySectors(now = Date.now()): Sector[] {
  const f6: [number, number][] = [
    [73.055, 33.72],
    [73.075, 33.72],
    [73.075, 33.735],
    [73.055, 33.735],
  ];
  const g9: [number, number][] = [
    [73.02, 33.685],
    [73.04, 33.685],
    [73.04, 33.702],
    [73.02, 33.702],
  ];

  return [
    {
      id: "sec_f6",
      name: "F-6",
      ring: closeRing(f6),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sec_g9",
      name: "G-9",
      ring: closeRing(g9),
      createdAt: now,
      updatedAt: now,
    },
  ];
}
