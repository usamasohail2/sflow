import type { Sector } from "@/lib/gameTypes";
import { closeRing } from "@/lib/geo";

/**
 * Guest-cookie mode for local testing.
 * Default: Google auth on. Set AUTH_DISABLED=true to use guests.
 */
export const AUTH_DISABLED =
  process.env.AUTH_DISABLED === "true" ||
  process.env.NEXT_PUBLIC_AUTH_DISABLED === "true";

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
  // Bot-held practice target, right next to F-6
  const e7: [number, number][] = [
    [73.079, 33.722],
    [73.098, 33.722],
    [73.098, 33.737],
    [73.079, 33.737],
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
    {
      id: "sec_e7",
      name: "E-7",
      ring: closeRing(e7),
      createdAt: now,
      updatedAt: now,
    },
  ];
}
