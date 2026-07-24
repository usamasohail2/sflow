import type { Sector } from "@/lib/gameTypes";
import { closeRing } from "@/lib/geo";

/** Temporary: skip Google auth — guest cookie identity instead */
export const AUTH_DISABLED = true;

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
